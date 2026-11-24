import { connectedSigner } from './wallet.mjs';
import { walletPanel } from './wallet-panel.mjs';
import { clientFor, explorer, finalReceipt, fund, leader, memberAddress, read, write } from './network.mjs';
import deployment from './deployment.json';
import './style.css';

const $ = id => document.getElementById(id);
const client = clientFor();
const { address } = deployment;
let active, selected, submit;
let busy = false;
let view = 'overview';
let currentRound;
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
  const wallet=active;
  submit=data=>active===wallet ? handler?.(data) : status('Wallet changed. Reopen the action to sign.');
  $('dialog').showModal();
}
$('cancel').onclick=()=>$('dialog').close();
$('form').onsubmit=event=>{
  event.preventDefault();
  const data=new FormData(event.currentTarget);
  $('dialog').close();
  submit?.(data);
};
walletPanel({
  client: client, fund, report: status,
  change(wallet) {
    active = wallet;
    refresh().catch(error => status(error.message));
  },
});
async function send(method,args){
  if(busy||!address) return;
  if(!active?.ready) return status('Connect a wallet on Stable Studionet first.');
  const wallet=active;
  busy=true;
  $('wallet').disabled=true;
  $('round').querySelectorAll('button').forEach(control=>control.disabled=true);
  let hash;
  let confirmed=false;
  try{
    const signer=wallet.external ? connectedSigner(wallet,()=>active===wallet,tx=>{
      hash=tx;
      status('Submitted · waiting for finality',hash);
    }) : clientFor(wallet.account);
    if(await signer.getChainId()!==61999) throw Error('Unexpected chain');
    status('Signing '+method.replaceAll('_',' ')+'…');
    hash=await write(signer,address,method,args);
    status('Submitted · waiting for finality',hash);
    const receipt=await finalReceipt(client,hash);
    const result=leader(receipt);
    if(receipt.statusName!=='FINALIZED'||result?.execution_result!=='SUCCESS') {
      throw Error('Transaction rejected: '+(result?.result?.payload??receipt.statusName));
    }
    confirmed=true;
    if(method==='open_round') selected=BigInt(result.result.payload.readable);
    await refresh(true);
    status('FINALIZED / SUCCESS · Final round state refreshed',hash);
  }catch(error){status((confirmed?'FINALIZED / SUCCESS · Final state read failed. Refresh the round. ':'')+error.message,hash);}
  finally{
    busy=false;
    updateWalletControls();
    if(currentRound?.id===selected) render(currentRound.round,currentRound.id);
  }
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
  const matrix=el('div',undefined,'seat-matrix');
  round.roster.forEach((member,index)=>{
    const evidence=recused.get(index);
    const entry=el('details',undefined,'seat');
    entry.append(el('summary','Seat '+(index+1)+' · '+(evidence?'Recused':round.state==='DISCLOSURES'?'Awaiting review':'Eligible'),evidence?'recused':''));
    entry.append(el('p',member),el('p',round.disclosures[index]||'Declaration pending.'));
    if(evidence){
      entry.append(el('blockquote',evidence[1]),el('blockquote',evidence[2]));
    }
    entry.open=Boolean(evidence);
    matrix.append(entry);
  });
  seats.append(matrix);
  const proposal=el('div',undefined,'sheet proposal');
  proposal.append(el('span',round.state==='AWAITING_REPLACEMENTS'?'QUORUM NOT MET':round.state,'badge'),el('h2','Proposal '+id),el('p',round.proposal),
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
  if(active?.ready && controls.childElementCount) proposal.append(controls);
  const blocked=round.state==='AWAITING_REPLACEMENTS';
  const keyReceipts=id===1n && round.state==='APPROVED'
    ? [['Recusal decision','reconcile-1'],['Final decision','resolve']]
    : id===2n && blocked
      ? [['Recusal decision','reconcile-2'],['Vote rejected below quorum','reject-blocked-vote']]
      : [];
  const decision=el('section',undefined,'sheet decision');
  decision.append(el('h2','Decision ledger'),el('p',decisionText(round)));
  if(keyReceipts.length){
    const receipts=el('nav',undefined,'controls');
    receipts.setAttribute('aria-label','Round evidence');
    for(const [label,key] of keyReceipts){
      const receipt=deployment.transactions?.[key];
      if(receipt) receipts.append(link(label+' ↗',receipt.hash));
    }
    decision.append(receipts);
  }
  const eligibility=el('section',undefined,'sheet eligibility');
  eligibility.append(el('h2','Voting eligibility'));
  if(round.state==='DISCLOSURES'){
    eligibility.append(el('p','Eligibility is established after the disclosures are reconciled.'));
  }else{
    const eligible=round.roster.length-recused.size;
    const meter=el('meter');
    meter.min=0;
    meter.max=round.roster.length;
    meter.low=Number(round.quorum);
    meter.high=Number(round.quorum);
    meter.optimum=round.roster.length;
    meter.value=eligible;
    meter.setAttribute('aria-label','Eligible seats out of the original committee');
    eligibility.append(el('p',eligible+' eligible / '+round.quorum+' required','quorum-number'),meter,
      el('p',eligible>=round.quorum?'Quorum met':'Below quorum · Voting is closed'));
    const markers=el('ol',undefined,'eligibility-seats');
    for(const [index] of round.roster.entries()){
      markers.append(el('li','Seat '+(index+1)+' · '+(recused.has(index)?'Recused':'Eligible'),recused.has(index)?'recused':''));
    }
    eligibility.append(markers);
  }
  const conflicts=el('section',undefined,'sheet conflicts');
  conflicts.append(el('h2','Conflict review'),
    el('p','The findings compare the submitted proposal and participants’ own disclosures.'));
  if(!round.recusals.length){
    conflicts.append(el('p',round.state==='DISCLOSURES'?'Review has yet to take place.':'No conflicts were found in the submitted material.'));
  }
  for(const [index,proposalQuote,disclosureQuote] of round.recusals){
    const caseFile=el('article',undefined,'case-file');
    const compare=el('div',undefined,'compare');
    for(const [label,quote] of [['Proposal',proposalQuote],['Disclosure',disclosureQuote]]){
      const source=el('div');
      source.append(el('p',label,'caps'),el('blockquote',quote));
      compare.append(source);
    }
    caseFile.append(el('h3','Seat '+(index+1)+' · Recused'),compare);
    conflicts.append(caseFile);
  }
  const sections={overview:[eligibility,decision],members:[seats],conflicts:[conflicts],eligibility:[eligibility],decision:[decision]};
  $('round').replaceChildren(proposal,...sections[view]);
}
function decisionText(round){
  if(round.state==='AWAITING_REPLACEMENTS') return 'No decision recorded. The remaining eligible members did not meet quorum.';
  if(['APPROVED','REJECTED'].includes(round.state)) return 'Final decision: '+round.state.toLowerCase()+' · '+round.yes+' yes / '+round.no+' no.';
  if(round.state==='VOTING') return 'Voting in progress · '+round.yes+' yes / '+round.no+' no.';
  return 'A decision can be recorded after the eligibility review and vote.';
}
for(const control of $('roundViews').querySelectorAll('button')){
  control.onclick=()=>{
    view=control.dataset.view;
    for(const option of $('roundViews').querySelectorAll('button')){
      option.setAttribute('aria-pressed',String(option===control));
    }
    if(currentRound) render(currentRound.round,currentRound.id);
  };
}

function updateWalletControls(){
  $('wallet').disabled=busy;
  $('open').disabled=!active?.ready||!address||busy;
}
async function refresh(throwOnError = false){
  updateWalletControls();
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
    if(selected===id){currentRound={round,id};render(round,id);}
  }catch(error){if(throwOnError===true) throw error; status(error.message);}
}
$('rounds').onchange=()=>{selected=BigInt($('rounds').value);refresh();};
$('refresh').onclick=refresh;
refresh();
