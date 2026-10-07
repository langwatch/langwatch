# instant-eval-judge

The Instant Evals judge, a dependency leaf that calls no peer (ADR-174 decision 13). It owns what a judge is asked and answers, what each judgement costs, and its own copies of the facts each judge call checks.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                                                              |
| Subjects       | instant-eval-judge                                                                                                                           |
| Halves         | [contract](contract) · [process](process/README.md)                                                                                          |
| Api token      | `InstantEvalJudgeApi` = `moduleApi<InstantEvalJudgeApi>()("instant-eval-judge")`, `contract/src/instant-eval-judge.api.ts:45` (5 operations) |
| Installed by   | api, worker, tasks (process)                                                                                                                 |

## What instant-eval-judge owns

| Kind            | Name                                                                                                                                                                                                                    | Declared at                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Postgres table  | `InstantEvalJudgeProject`                                                                                                                                                                                               | `process/src/repositories/prisma/prisma.instant-eval-judge-project.repository.ts:11`       |
| Postgres table  | `InstantEvalJudgeSpend`                                                                                                                                                                                                 | `process/src/repositories/prisma/prisma.instant-eval-judge-spend.repository.ts:12`         |
| Postgres table  | `InstantEvalJudgeUsageBilling`                                                                                                                                                                                          | `process/src/repositories/prisma/prisma.instant-eval-judge-usage-billing.repository.ts:15` |
| Stores required | prisma, redis                                                                                                                                                                                                           | `process/src/repositories/live/live.instant-eval-judge.repositories.ts:10`                 |
| Secrets         | `classifierApiKey` (JEV_API_KEY)                                                                                                                                                                                        | `process/src/app/instant-eval-judge.app.ts:60`                                             |
| Config          | `classifierBaseUrl` (JEV_BASE_URL), `classifierModel` (JEV_MODEL), `globalTokensPerSecond` (INSTANT_EVAL_GLOBAL_TOKENS_PER_SECOND), `tenantTokensPerSecond` (INSTANT_EVAL_TENANT_TOKENS_PER_SECOND), `isSaas` (IS_SAAS) | `contract/src/instant-eval-judge.config.ts:10`                                             |

Anything else instant-eval-judge needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

None: instant-eval-judge declares no peers.

## Who depends on instant-eval-judge

[evaluation](../evaluation/README.md), [instant-eval](../instant-eval/README.md) (as a peer).

<!-- readme:generated:end -->
