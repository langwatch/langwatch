# @langwatch/instant-eval-judge-process

The server half of [instant-eval-judge](../README.md). It keeps the judge's own copies of the facts each judge call checks: each project's organization, whether the meter bills an organization, and the judge's spend.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("instant-eval-judge").withRepositories(instantEvalJudgeRepositories).withApi(InstantEvalJudgeModule).withEventing(instantEvalJudgeFactsEventing)`, `src/instant-eval-judge.module.ts:7`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`InstantEvalJudgeApi`)

No ops yet: the judge call arrives with the module's process half (ADR-174 decision 10).

Peers call these through the token, declared at `../contract/src/instant-eval-judge.api.ts:12`; nothing else in this package is public.

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

## Configuration

None: no `static secrets` or `static config` leaf.

<!-- readme:generated:end -->
