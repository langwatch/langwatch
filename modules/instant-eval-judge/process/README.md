# @langwatch/instant-eval-judge-process

The server half of [instant-eval-judge](../README.md). It keeps the judge's own copies of the facts each judge call checks: each project's organization, whether the meter bills an organization, and the judge's spend.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("instant-eval-judge").withRepositories(instantEvalJudgeRepositories).withApi(InstantEvalJudgeModule).withEventing(instantEvalJudgeFactsEventing).withEventing(instantEvalJudgeSpendEventing)`, `src/instant-eval-judge.module.ts:8`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`InstantEvalJudgeApi`)

The judge call and the cloud classifier behind it (ADR-174 decisions 10, 13). It calls no peer: what it checks before each call comes from its own copies of its peers' facts.

Peers call these through the token, declared at `../contract/src/instant-eval-judge.api.ts:15`; nothing else in this package is public.

#### `isClassifierConfigured`

Whether this deployment holds LangWatch's classifier key. A peer Api cannot be called at startup, so Instant Evals asks this on its first call to choose the key or Connect.

```typescript
isClassifierConfigured(): Promise<boolean>;
```

#### `classify`

One classification with LangWatch's key, priced by nobody: runs, judged queries and the search bar record their own spend. Skips as `classifier_not_configured` where there is no key.

```typescript
classify(input: InstantEvalClassification): Promise<InstantEvalJudgement>;
```

#### `judge`

One metered judge call: unknown project, cloud only, budget, classify, price, priced event. A refusal is returned, never thrown, and calls no classifier.

```typescript
judge(input: InstantEvalJudgeCall): Promise<InstantEvalJudgeAnswer>;
```

## REST transport

None: this module declares no REST family.

## tRPC transport

None: this module declares no tRPC router.

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `instant_eval_judge_facts` (aggregate `global`)

Declared at `src/eventing/instant-eval-judge-facts.pipeline.ts:35`.

| Kind            | Name                                  | Handles                                                                                          | Declared at                                            |
| --------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| peer subscriber | `instantEvalJudgeProjectCreated`      | `lw.project.created` from [project](../../project/README.md)                                     | `src/eventing/instant-eval-judge-facts.pipeline.ts:42` |
| peer subscriber | `instantEvalJudgeUsageBillingChanged` | `lw.billing.usage_billing_changed` from [billing](../../../enterprise/modules/billing/README.md) | `src/eventing/instant-eval-judge-facts.pipeline.ts:48` |

### Pipeline `instant_eval_judge_spend` (aggregate `instant_eval_judge_spend`)

Declared at `src/eventing/instant-eval-judge-spend.pipeline.ts:41`. Events: `instantEvalJudgeSpendPricedEventSchema`.

| Kind       | Name                       | Handles                                                                      | Declared at                                            |
| ---------- | -------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| command    | `recordSpendPriced`        | –                                                                            | `src/eventing/instant-eval-judge-spend.pipeline.ts:46` |
| subscriber | `instantEvalJudgeSpendRow` | `lw.instant_eval_judge.spend_priced` from [instant-eval-judge](../README.md) | `src/eventing/instant-eval-judge-spend.pipeline.ts:47` |

## Configuration

| Kind   | Leaf                    | Environment variable                    | Declared at                                       |
| ------ | ----------------------- | --------------------------------------- | ------------------------------------------------- |
| secret | `classifierApiKey`      | `JEV_API_KEY`                           | `src/app/instant-eval-judge.app.ts:56`            |
| config | `classifierBaseUrl`     | `JEV_BASE_URL`                          | `../contract/src/instant-eval-judge.config.ts:10` |
| config | `classifierModel`       | `JEV_MODEL`                             | `../contract/src/instant-eval-judge.config.ts:18` |
| config | `globalTokensPerSecond` | `INSTANT_EVAL_GLOBAL_TOKENS_PER_SECOND` | `../contract/src/instant-eval-judge.config.ts:20` |
| config | `tenantTokensPerSecond` | `INSTANT_EVAL_TENANT_TOKENS_PER_SECOND` | `../contract/src/instant-eval-judge.config.ts:25` |
| config | `isSaas`                | `IS_SAAS`                               | `../contract/src/instant-eval-judge.config.ts:30` |

<!-- readme:generated:end -->
