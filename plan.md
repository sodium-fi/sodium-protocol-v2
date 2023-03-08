## Private Pool Implementation Decisions

- How do we create pools? Which contract deploys them? Where is a record of their status kept (i.e. `mapping(address => bool) isPool`)?
- We need to think about how to allow the pool to accept arbitrary oracles. May need to build adapter (oracle-wrapper) contracts?

## V1 Changes

- Change resolve auction into a method that is called by each relevant auction actor. This avoids one actor paying for all the computation.
  - Lenders only claim their own funds
  - Borrower only clams the collateral
- Cheaper to have initial APR off-chain => only emitted during request, not utilised further
- can the validation sig just be based of the sig or smth? could be cheaper

## Possible future features to include in build

- Multi collateral loan
- meta-lenders make offers for any loan request with a specifc collection as collateral
- public pools deposit liquidity in compound etc when it is not utilised
