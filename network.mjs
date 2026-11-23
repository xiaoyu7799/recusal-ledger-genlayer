import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { CalldataAddress, TransactionHashVariant } from 'genlayer-js/types';
export const clientFor = account => createClient({chain: studionet, endpoint:'https://studio.genlayer.com/api', account});
export const explorer = 'https://explorer-studio.genlayer.com';
export function memberAddress(address) {
  if (!/^0x[0-9a-f]{40}$/i.test(address)) throw Error('Invalid wallet address');
  return new CalldataAddress(Uint8Array.from(address.slice(2).match(/../g), byte => parseInt(byte,16)));
}
export const finalReceipt = (client, hash) => client.waitForTransactionReceipt({hash,waitUntil:'finalized',fullTransaction:true,retries:240,interval:3000});
export function leader(receipt) {
  const section = receipt.consensus_data?.leader_receipt;
  return Array.isArray(section) ? section[0] : section;
}
export const read = (client,address,functionName,args=[]) => client.readContract({address,functionName,args,transactionHashVariant:TransactionHashVariant.LATEST_FINAL});
export const fund = (client,address) => client.request({method:'sim_fundAccount',params:[address,100]});
export const write = async (client,address,functionName,args) => client.writeContract({
  address,functionName,args,value:0n,leaderOnly:false,fees:await client.estimateTransactionFees(),
});
