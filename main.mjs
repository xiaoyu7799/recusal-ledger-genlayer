import { createAccount } from 'genlayer-js';
import { clientFor, explorer, finalReceipt, fund, leader, memberAddress, read, write } from './network.mjs';
import deployment from './deployment.json';
import './style.css';

const $ = id => document.getElementById(id);
const client = clientFor();
const { address } = deployment;
const wallets = [];
let active, selected, submit;
let busy = false;
const el = (tag,text,cls) => {
  const node=document.createElement(tag);
  if(text!==undefined) node.textContent=text;
  if(cls) node.className=cls;
  return node;
};
function button(label,handler){
  const node=el('button',label);
  node.type='button';
  node.onclick=handler;
  node.disabled=busy;
  return node;
}
function link(label,hash){
  const node=el('a',label);
  node.href=explorer+'/transactions/'+hash;
  node.target='_blank';
  node.rel='noreferrer';
  return node;
}
function status(text,hash){
  $('status').replaceChildren(el('span',text));
  if(hash) $('status').append(' ',link('View receipt ↗',hash));
}
function field(label,name,tag='textarea'){
  const node=el('label',label);
  const input=el(tag);
  input.name=name;
  input.required=true;
  node.append(input);
  return node;
}
function modal(title,fields,handler){
  $('dialog-title').textContent=title;
  $('fields').replaceChildren(...fields);
  $('signer').textContent=handler ? 'Stable Studionet 61999 · '+active.address : 'Session only. Use test GEN. Refresh clears these wallets.';
  $('confirm').hidden=!handler;
  submit=handler;
  $('dialog').showModal();
}
$('cancel').onclick=()=>$('dialog').close();
$('form').onsubmit=event=>{
  event.preventDefault();
  const data=new FormData(event.currentTarget);
  $('dialog').close();
  submit?.(data);
};
$('wallet').onclick=()=>{
  const actions=wallets.map(wallet=>button(wallet.address,()=>{active=wallet; $('dialog').close(); refresh();}));
  actions.push(button('Create session wallet',()=>{
    active=createAccount();
    wallets.push(active);
    $('dialog').close();
    refresh();
  }));
  if(active) actions.push(button('Fund active wallet',async()=>{
    try{
      const signer=clientFor(active);
      await fund(signer,active.address);
      status('Test balance: '+await signer.getBalance({address:active.address})+' base units');
    }catch(error){status(error.message);}
    $('dialog').close();
  }));
  modal('Test wallets',actions);
};
async function send(method,args){
  if(!active||busy||!address) return;
  const signer=clientFor(active);
  busy=true;
  let hash;
  try{
    if(await signer.getChainId()!==61999) throw Error('Unexpected chain');
    status('Signing '+method.replaceAll('_',' ')+'…');
    hash=await write(signer,address,method,args);
    status('Submitted · waiting for finality',hash);
    const receipt=await finalReceipt(client,hash);
    const result=leader(receipt);
    if(receipt.statusName!=='FINALIZED'||result?.execution_result!=='SUCCESS') {
      throw Error('Transaction rejected: '+(result?.result?.payload??receipt.statusName));
    }
    if(method==='open_round') selected=BigInt(result.result.payload.readable);
    status('Finalized · Success',hash);
  }catch(error){status(error.message,hash);}
  finally{busy=false;await refresh();}
}
$('open').onclick=()=>modal('Open a committee round',[
  field('Proposal text','proposal'),
  field('Committee wallet addresses, separated by commas or newlines','roster'),
  field('Quorum','quorum','input'),
],data=>{
  try{
    const roster=data.get('roster').trim().split(/[\s,]+/).map(memberAddress);
    const quorum=BigInt(data.get('quorum'));
    send('open_round',[data.get('proposal'),roster,quorum]);
  }catch(error){status(error.message);}
});
function render(round,id){
  const recused=new Map(round.recusals.map(row=>[row[0],row]));
  const seats=el('div',undefined,'sheet');
  seats.append(el('h2','Committee seats'));
  round.roster.forEach((member,index)=>{
    const evidence=recused.get(index);
    const entry=el('details',undefined,'seat');
    entry.append(el('summary','Seat '+(index+1)+' · '+(evidence?'Recused':round.state==='DISCLOSURES'?'Awaiting review':'Eligible'),evidence?'recused':''));
    entry.append(el('p',member),el('p',round.disclosures[index]||'Declaration pending.'));
    if(evidence){
      entry.append(el('blockquote',evidence[1]),el('blockquote',evidence[2]));
    }
    entry.open=Boolean(evidence);
    seats.append(entry);
  });
  const proposal=el('div',undefined,'sheet');
  proposal.append(el('span',round.state.replaceAll('_',' '),'badge'),el('h2','Proposal '+id),el('p',round.proposal),
    el('p','Chair: '+round.chair),
    el('p',round.state==='DISCLOSURES'?'Voting roster pending review.':(round.roster.length-recused.size)+' eligible · '+round.quorum+' quorum'),
    el('p','Yes '+round.yes+' · No '+round.no));
  const controls=el('div',undefined,'controls');
  const seat=round.roster.findIndex(member=>member.toLowerCase()===active?.address.toLowerCase());
  if(round.state==='DISCLOSURES'){
    if(seat>=0) controls.append(button('Sign disclosure',()=>modal('Sign a public disclosure',[field('Declaration','declaration')],data=>send('disclose',[id,data.get('declaration')]))));
    if(round.chair.toLowerCase()===active?.address.toLowerCase())
      controls.append(button('Reconcile disclosures',()=>modal('Lock voting eligibility',[el('p','Validators compare the signed disclosures and proposal.')],()=>send('reconcile',[id]))));
  }
  if(round.state==='VOTING'&&active){
    if(seat>=0&&!recused.has(seat)) {
      for(const choice of [true,false]) controls.append(button(choice?'Vote yes':'Vote no',()=>modal(choice?'Vote yes':'Vote no',[],()=>send('vote',[id,choice]))));
    }
    if(round.yes+round.no===round.roster.length-recused.size)
      controls.append(button('Record decision',()=>modal('Record decision',[],()=>send('resolve',[id]))));
  }
  if(round.state==='AWAITING_REPLACEMENTS')
    proposal.append(el('p','This round is locked below quorum. Convene a separate round with a revised committee.'));
  proposal.append(controls);
  const grid=el('div',undefined,'grid');
  grid.append(proposal,seats);
  $('round').replaceChildren(grid);
}
async function refresh(){
  $('wallet').textContent=active?active.address.slice(0,9)+'…':'Test wallets';
  $('open').disabled=!active||!address||busy;
  if(!address){$('round').textContent='Deployment evidence pending.';return;}
  try{
    const total=BigInt(await read(client,address,'get_count'));
    if(!total){$('round').textContent='No rounds yet.';return;}
    selected??=1n;
    const values=new Set([selected]);
    for(let id=total;id>0n&&id>=total-19n;id--) values.add(id);
    $('rounds').replaceChildren(...Array.from(values,id=>{
      const option=el('option','Round '+id);
      option.value=String(id);
      return option;
    }));
    $('rounds').value=String(selected);
    const id=selected;
    const round=await read(client,address,'get_round',[id]);
    if(selected===id) render(round,id);
  }catch(error){status(error.message);}
}
$('rounds').onchange=()=>{selected=BigInt($('rounds').value);refresh();};
$('refresh').onclick=refresh;
const list=el('ul');
for(const [name,receipt] of Object.entries(deployment.transactions??{})){
  const row=el('li');
  row.append(link(name.replaceAll('-',' '),receipt.hash),' · '+receipt.status+' / '+receipt.execution);
  list.append(row);
}
$('receipts').append(list);
refresh();
