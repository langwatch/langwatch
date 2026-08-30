# Feature cleanup — progress

Three stages per feature, per the standard in
[`feature-cleanup-review.md`](../../best_practices/feature-cleanup-review.md).

| Stage | What | Writes |
| --- | --- | --- |
| 1 · review | Audit the feature against R1–R8 | `<feature>.md` |
| 2 · verify | Adversarially check the review: struck claims, missed problems, over-reach | `<feature>.md` (a Verification section) |
| 3 · enact | Apply the verified review, commit by commit | source |

Stage 1 and 2 are read-only over source. Stage 3 writes, and runs in small
batches because features share `platform/app/src/features/errors/logic/{codes,presentation}.ts`.

`dataset.md` is the reference review. The orchestrator builds dataset's
enactment by hand first; stage-3 agents copy that, they do not invent it.

## Status

| Feature | Files | Lines | 1 · review | 2 · verify | 3 · enact |
| --- | ---: | ---: | --- | --- | --- |
| dataset | 35 | 9147 | done (reference) | — | in progress |
| secret | 9 | 639 | running | | |
| stored-object | 22 | 2592 | running | | |
| api-key | 24 | 4102 | running | | |
| trace | 181 | 29990 | | | |
| governance (ent) | 143 | 24097 | | | |
| scenario | 90 | 16758 | | | |
| gateway | 79 | 16278 | | | |
| langy | 85 | 15111 | | | |
| authz | 51 | 13531 | | | |
| automation | 78 | 10925 | | | |
| coding-agent | 52 | 10059 | | | |
| analytics | 30 | 9917 | | | |
| ops | 49 | 9508 | | | |
| organization | 20 | 7885 | | | |
| experiment | 40 | 7106 | | | |
| identity | 48 | 6956 | | | |
| model-provider | 33 | 6595 | | | |
| billing (ent) | 42 | 6287 | | | |
| prompt | 19 | 6156 | | | |
| webhook (ent) | 20 | 5056 | | | |
| topic | 29 | 4783 | | | |
| github | 34 | 4668 | | | |
| evaluation | 31 | 4284 | | | |
| dashboard | 16 | 3889 | | | |
| scim (ent) | 20 | 3860 | | | |
| workflow | 16 | 3814 | | | |
| metric | 26 | 3334 | | | |
| suite | 22 | 3136 | | | |
| project | 12 | 2740 | | | |
| annotation | 11 | 2691 | | | |
| evaluator | 14 | 2619 | | | |
| user | 11 | 2567 | | | |
| agent | 14 | 2269 | | | |
| data-retention | 18 | 1792 | | | |
| role | 10 | 1658 | | | |
| feature-flag | 16 | 1653 | | | |
| monitor | 8 | 1605 | | | |
| share | 11 | 1601 | | | |
| licensing (ent) | 16 | 1571 | | | |
| log | 13 | 1366 | | | |
| sso (ent) | 5 | 1202 | | | |
| auth | 9 | 971 | | | |
| presence | 9 | 731 | | | |
| data-privacy | 6 | 391 | | | |
| entitlement | 5 | 338 | | | |
| managed-provider (ent) | 7 | 305 | | | |
| audit-log (ent) | 5 | 206 | | | |
| notification | 5 | 114 | | | |

49 features, 268,000 lines of feature-server source.
