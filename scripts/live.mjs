import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createAccount, generatePrivateKey } from 'genlayer-js';
import { clientFor, finalReceipt, fund, leader, memberAddress, read, write } from '../network.mjs';

const keys = '../.recusal-demo-keys.json';
const journal = '../recusal-live-journal.json';
if (!existsSync(keys)) {
  writeFileSync(keys, JSON.stringify(Array.from({length:5}, () => generatePrivateKey())), {flag:'wx',mode:0o600});
}
const accounts = JSON.parse(readFileSync(keys)).map(key => createAccount(key));
const clients = accounts.map(clientFor);
const chair = clients[0];
const evidence = existsSync(journal) ? JSON.parse(readFileSync(journal)) : {transactions:{},states:{}};
const save = () => {
  writeFileSync(journal+'.tmp', JSON.stringify(evidence,null,2));
  renameSync(journal+'.tmp',journal);
};
const code = readFileSync(new URL('../contracts/recusal_ledger.py', import.meta.url));
const hash = createHash('sha256').update(code).digest('hex');
assert.equal(await chair.getChainId(),61999);
if (evidence.source) assert.equal(evidence.source,hash);
evidence.source=hash;

async function transact(name,client,submit,expected) {
  const entry = evidence.transactions[name] ??= {hash:await submit(),sender:client.account.address};
  save();
  console.log(name,entry.hash);
  const receipt=await finalReceipt(client,entry.hash);
  entry.status=receipt.statusName;
  entry.execution=leader(receipt)?.execution_result;
  entry.result=leader(receipt)?.result;
  entry.votes=receipt.consensus_data?.votes;
  save();
  assert.equal(entry.status,'FINALIZED',name);
  assert.equal(entry.execution,expected?'ERROR':'SUCCESS',name);
  if(expected) assert.equal(entry.result?.payload,expected,name);
  return receipt;
}
await Promise.all(clients.map(async client=>{
  if(await client.getBalance({address:client.account.address})===0n) await fund(client,client.account.address);
}));
const deployment=await transact('deploy',chair,async()=>chair.deployContract({
  code:new Uint8Array(code),leaderOnly:false,fees:await chair.estimateTransactionFees(),
}));
const address=evidence.address=deployment.to_address;
assert.deepEqual(Buffer.from(await chair.request({method:'gen_getContractCode',params:[address]}),'base64'),code);
evidence.sourceMatches=true;
save();
const send=(name,client,method,args,error)=>transact(name,client,()=>write(client,address,method,args),error);
const roster=accounts.map(account=>memberAddress(account.address));
const proposals=[
  'Neighborhood reading pilot. Amber Library will receive a grant to deliver the pilot. Birch Studio and Cedar Works are listed as unpaid community advisers.',
  'Neighborhood workshop pilot. Amber Library will receive a grant to deliver the pilot. Birch Studio will be a paid subcontractor. Cedar Works will be a paid implementation partner.',
];
const declarations=[
  'I am currently employed by Amber Library.',
  'I hold an ownership stake in Birch Studio.',
  'I hold a compensated role at Cedar Works.',
  'I have no relevant financial or organizational interests.',
  'I have no relevant financial or organizational interests.',
];
for(let index=0;index<2;index++){
  const id=BigInt(index+1);
  await send('open-'+id,chair,'open_round',[proposals[index],roster,3n]);
}
for(let index=0;index<2;index++){
  const id=BigInt(index+1);
  await Promise.all(clients.map((client,seat)=>send('disclose-'+id+'-'+seat,client,'disclose',[id,declarations[seat]])));
}
for(const id of [1n,2n]){
  await send('reconcile-'+id,chair,'reconcile',[id]);
  const observed=await read(chair,address,'get_round',[id]);
  evidence.states['review'+id]=observed;
  save();
  assert.deepEqual(observed.recusals.map(row=>row[0]),id===1n?[0]:[0,1,2]);
  assert.equal(observed.state,id===1n?'VOTING':'AWAITING_REPLACEMENTS');
}
await Promise.all([
  send('reject-recused-seat',clients[0],'vote',[1n,true],'SEAT_INELIGIBLE'),
  send('reject-blocked-vote',clients[3],'vote',[2n,true],'VOTING_CLOSED'),
]);
await Promise.all(clients.slice(1).map((client,index)=>send('ballot-'+index,client,'vote',[1n,index!==3])));
await send('resolve',chair,'resolve',[1n]);
await send('reject-blocked-resolution',chair,'resolve',[2n],'RESOLUTION_UNAVAILABLE');
evidence.states.approved=await read(chair,address,'get_round',[1n]);
evidence.states.blocked=await read(chair,address,'get_round',[2n]);
assert.equal(evidence.states.approved.state,'APPROVED');
assert.equal(evidence.states.approved.yes,3);
assert.equal(evidence.states.approved.no,1);
assert.deepEqual(evidence.states.blocked,evidence.states.review2);
save();
