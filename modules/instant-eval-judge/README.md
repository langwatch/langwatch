# instant-eval-judge

The Instant Evals judge, a dependency leaf that calls no peer (ADR-174 decision 13). It owns what a judge is asked and answers, what each judgement costs, and its own copies of the facts each judge call checks.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                                                              |
| Subjects       | instant-eval-judge                                                                                                                           |
| Halves         | [contract](contract) · [process](process/README.md)                                                                                          |
| Api token      | `InstantEvalJudgeApi` = `moduleApi<InstantEvalJudgeApi>()("instant-eval-judge")`, `contract/src/instant-eval-judge.api.ts:14` (0 operations) |
| Installed by   | api, worker, tasks (process)                                                                                                                 |

## What instant-eval-judge owns

| Kind           | Name                           | Declared at                                                                                |
| -------------- | ------------------------------ | ------------------------------------------------------------------------------------------ |
| Postgres table | `InstantEvalJudgeProject`      | `process/src/repositories/prisma/prisma.instant-eval-judge-project.repository.ts:11`       |
| Postgres table | `InstantEvalJudgeSpend`        | `process/src/repositories/prisma/prisma.instant-eval-judge-spend.repository.ts:12`         |
| Postgres table | `InstantEvalJudgeUsageBilling` | `process/src/repositories/prisma/prisma.instant-eval-judge-usage-billing.repository.ts:15` |

Anything else instant-eval-judge needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

None: instant-eval-judge declares no peers.

## Who depends on instant-eval-judge

No module names instant-eval-judge as a peer.

<!-- readme:generated:end -->
