# instant-eval-judge

The Instant Evals judge, a dependency leaf that calls no peer (ADR-174 decision 13). It owns what a judge is asked and answers, what each judgement costs, and its own copies of the facts each judge call checks.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                                                              |
| Subjects       | instant-eval-judge                                                                                                                           |
| Halves         | [contract](contract) · [process](process/README.md)                                                                                          |
| Api token      | `InstantEvalJudgeApi` = `moduleApi<InstantEvalJudgeApi>()("instant-eval-judge")`, `contract/src/instant-eval-judge.api.ts:57` (6 operations) |
| Installed by   | api, worker, tasks (process)                                                                                                                 |

## What instant-eval-judge owns

| Kind                           | Name                                                                                                                                                                                                                                                                                                                                               | Declared at                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Postgres table                 | `InstantEvalJudgeSpend`                                                                                                                                                                                                                                                                                                                            | `process/src/repositories/prisma/prisma.instant-eval-judge-spend.repository.ts:12`         |
| Postgres table                 | `InstantEvalJudgeUsageBilling`                                                                                                                                                                                                                                                                                                                     | `process/src/repositories/prisma/prisma.instant-eval-judge-usage-billing.repository.ts:15` |
| Postgres, accessed not claimed | `Project`, `Team`                                                                                                                                                                                                                                                                                                                                  | `process/src/repositories/prisma/prisma.instant-eval-judge-placement.repository.ts:9`      |
| Stores required                |                                                                                                                                                                                                                                                                                                                                                    | `process/src/channels/http/http.instant-eval-judge.channels.ts:22`                         |
| Stores required                | prisma, redis                                                                                                                                                                                                                                                                                                                                      | `process/src/repositories/live/live.instant-eval-judge.repositories.ts:10`                 |
| Stores required                | ≈ `ownedRepositories.requires`                                                                                                                                                                                                                                                                                                                     | `process/src/repositories/prisma/prisma.instant-eval-judge.repositories.ts:17`             |
| Secrets                        | `classifierApiKey` (JEV_API_KEY), `hostedDecisionsApiKey` (INSTANT_EVAL_DECISIONS_API_KEY), `llmJudgeAnthropicApiKey` (INSTANT_EVAL_ANTHROPIC_API_KEY), `llmJudgeOpenAiApiKey` (INSTANT_EVAL_OPENAI_API_KEY)                                                                                                                                       | `process/src/app/instant-eval-judge.app.ts:78`                                             |
| Config                         | `classifierBaseUrl` (JEV_BASE_URL), `classifierModel` (JEV_MODEL), `globalTokensPerSecond` (INSTANT_EVAL_GLOBAL_TOKENS_PER_SECOND), `tenantTokensPerSecond` (INSTANT_EVAL_TENANT_TOKENS_PER_SECOND), `judgeRoutes` (INSTANT_EVAL_JUDGE_ROUTES), `judgeRoutePricing` (INSTANT_EVAL_JUDGE_PRICING), `isSaas` (IS_SAAS), `nodeEnvironment` (NODE_ENV) | `contract/src/instant-eval-judge.config.ts:32`                                             |

Anything else instant-eval-judge needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

None: instant-eval-judge declares no peers.

## Who depends on instant-eval-judge

[evaluation](../evaluation/README.md) (as a peer).

<!-- readme:generated:end -->
