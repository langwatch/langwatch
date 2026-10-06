# @langwatch/usage-process

The server half of [usage](../README.md). Usage: the billable-events meter, the month's count and the limit decisions peers react to.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("usage").withRepositories(usageRepositories).withApi(UsageModule).withEventing(usageEventing)`, `src/usage.module.ts:7`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`UsageApi`)

Usage answers by events (§3): no peer asks it, so the token carries no operation yet.

Peers call these through the token, declared at `../contract/src/usage.events.ts:57`; nothing else in this package is public.
It extends `Readonly<Record<never, never>>`.

## REST transport

None: this module declares no REST family.

## tRPC transport

None: this module declares no tRPC router.

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `usage` (aggregate `usage_organization`)

Declared at `src/eventing/usage.pipeline.ts:67`. Events: `monthCountedEventSchema`, `limitReachedEventSchema`, `limitClearedEventSchema`.

The chain builds early when `!meterStores` (`src/eventing/usage.pipeline.ts:85`); the rows built only past that return say so. The caller's arguments decide which role gets which build.

| Kind                  | Name                                                                         | Handles                                     | Declared at                          | Built                |
| --------------------- | ---------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------ | -------------------- |
| command               | –                                                                            | –                                           | `src/eventing/usage.pipeline.ts:72`  | always               |
| command               | `recordLimitDecision`                                                        | –                                           | `src/eventing/usage.pipeline.ts:84`  | always               |
| process manager       | `refusedOrganizations`                                                       | intents `countMonth`, `recordLimitDecision` | `src/eventing/usage.pipeline.ts:87`  | past the early build |
| global map projection | `≈ BillableEventsMeterProjection.create(meterStores.billableEvents).build()` | –                                           | `src/eventing/usage.pipeline.ts:98`  | past the early build |
| global map projection | `≈ TraceMeterProjection.create(meterStores.traces).build()`                  | –                                           | `src/eventing/usage.pipeline.ts:102` | past the early build |

## Configuration

| Kind   | Leaf     | Environment variable | Declared at                          |
| ------ | -------- | -------------------- | ------------------------------------ |
| config | `isSaas` | `IS_SAAS`            | `../contract/src/usage.events.ts:63` |

<!-- readme:generated:end -->
