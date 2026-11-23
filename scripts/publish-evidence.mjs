import { readFileSync, writeFileSync } from 'node:fs';

const journal = JSON.parse(readFileSync(new URL('../../recusal-live-journal.json', import.meta.url)));
if (!journal.address || !journal.sourceMatches) throw Error('Deployment source comparison required.');
journal.transactions = Object.fromEntries(Object.entries(journal.transactions).filter(([,tx])=>tx.status==='FINALIZED'));
writeFileSync(new URL('../deployment.json', import.meta.url), JSON.stringify(journal,null,2)+'\n');
