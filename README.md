# Recusal Ledger

A governance workbench for grant committees. A chair opens a round and locks a committee roster and quorum. Each member signs a disclosure. GenLayer validators independently evaluate the proposal and disclosures under a fixed policy and must agree on the exact recusal list and supporting quotations. The contract uses that outcome to lock voting eligibility or block the round below quorum.

Each eligible wallet can cast one public ballot. Once every eligible seat has voted, any wallet may record the result. A strict majority approves the proposal. An equally divided vote rejects it. A round below quorum cannot accept ballots or record a decision. The chair can convene a new round with a revised roster.

## Review policy

An ongoing paid role, employment or ownership triggers recusal when the same organization is explicitly paid by the proposal. Ambiguous input keeps the review from advancing. Quotations must occur verbatim in the proposal and in the corresponding declaration. Independent model executions are compared by strict equality. Disagreement can prevent progress and should be resolved by collecting clearer disclosures in a new round.

The application records a public procedural decision. It does not verify the truth of member declarations or move funds. Only synthetic documents should be used in the public demonstration.

## Run

Use Node.js 24. Run `npm ci`, then `npm run dev` or `npm run build`. Test wallets are created in browser memory and use Stable Studionet (61999); use only test GEN.

Run `genvm-lint check contracts/recusal_ledger.py` with GenVM Lint 0.11.0. The first line of the contract identifies its runner. `npm run verify:live` deploys the exact file, compares remote source bytes and records finalized receipts in a journal outside this repository. Run the script once at a time and retain the journal to resume a pending run.

Run `python3 scripts/test_contract.py` for isolated workflow checks. These tests use controlled validator outputs. Run `npm run verify` to recheck published receipts and final readbacks once the complete two-round evidence has been published.
