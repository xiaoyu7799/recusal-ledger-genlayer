import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { clientFor, leader, read } from '../network.mjs';

const deployment=JSON.parse(readFileSync(new URL('../deployment.json',import.meta.url)));
const source=readFileSync(new URL('../contracts/recusal_ledger.py',import.meta.url));
const client=clientFor();
assert.equal(await client.getChainId(),61999);
assert.equal(createHash('sha256').update(source).digest('hex'),deployment.source);
assert.deepEqual(Buffer.from(await client.request({
  method:'gen_getContractCode',params:[deployment.address],
}),'base64'),source);
async function verifyReceipt([label,entry]){
  const tx=await client.getTransaction({hash:entry.hash});
  assert.equal(tx.statusName,'FINALIZED',label);
  assert.equal(leader(tx)?.execution_result,entry.execution,label);
  assert.equal(tx.to_address.toLowerCase(),deployment.address.toLowerCase(),label);
  assert.equal(tx.from_address.toLowerCase(),entry.sender.toLowerCase(),label);
  assert.deepEqual(leader(tx)?.result,entry.result,label);
  return [label,tx.statusName,entry.execution,entry.hash];
}
const entries=Object.entries(deployment.transactions);
for(let i=0;i<entries.length;i+=4){
  const checked=await Promise.all(entries.slice(i,i+4).map(verifyReceipt));
  for(const result of checked) console.log(...result);
}
const expectedRejections={
  'reject-recused-seat':'SEAT_INELIGIBLE',
  'reject-blocked-vote':'VOTING_CLOSED',
  'reject-blocked-resolution':'RESOLUTION_UNAVAILABLE',
};
for(const [label,reason] of Object.entries(expectedRejections)){
  const receipt=deployment.transactions[label];
  assert.equal(receipt?.execution,'ERROR',label);
  assert.equal(receipt.result?.payload,reason,label);
}
assert.deepEqual(deployment.states.blocked, deployment.states.review2);
assert.deepEqual(deployment.states.approved?.recusals.map(row=>row[0]),[0]);
assert.deepEqual(deployment.states.blocked?.recusals.map(row=>row[0]),[0,1,2]);
assert.equal(deployment.states.approved?.yes,3);
assert.equal(deployment.states.approved?.no,1);
assert.equal(deployment.states.approved?.state,'APPROVED');
assert.equal(deployment.states.blocked?.state,'AWAITING_REPLACEMENTS');
for(const [id,key] of [[1n,'approved'],[2n,'blocked']]){
  const current=await read(client,deployment.address,'get_round',[id]);
  assert.deepEqual(current,deployment.states[key]);
  console.log('latest-final',id.toString(),current.state);
}
