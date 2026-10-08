# instant-eval

Instant evaluations: the opt-in, the estimate, and running or cancelling an instant evaluation over sampled data.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Classification | core (`modules/catalogue.json`)                                                                                          |
| Subjects       | instant-eval                                                                                                             |
| Halves         | [contract](contract) · [process](process/README.md)                                                                      |
| Api token      | `InstantEvalApi` = `moduleApi<InstantEvalApi>()("instant-eval")`, `contract/src/instant-eval.api.ts:242` (19 operations) |
| Installed by   | api, worker, tasks (process)                                                                                             |

## What instant-eval owns

| Kind                      | Name                                                                                                                                                                               | Declared at                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| ClickHouse table (writes) | `instant_eval_judgments`                                                                                                                                                           | `process/src/repositories/clickhouse/clickhouse.instant-eval-judgments.repository.ts:103` |
| ClickHouse table (writes) | `instant_eval_runs`                                                                                                                                                                | `process/src/repositories/clickhouse/clickhouse.instant-eval-run.repository.ts:188`       |
| Stores required           | clickhouse, redis                                                                                                                                                                  | `process/src/repositories/live/live.instant-eval.repositories.ts:14`                      |
| Config                    | `classifier` (INSTANT_EVAL_CLASSIFIER), `isBounded` (INSTANT_EVAL_BOUNDED), `queryTokenBudget` (INSTANT_EVAL_QUERY_TOKEN_BUDGET), `isSaas` (IS_SAAS), `nodeEnvironment` (NODE_ENV) | `contract/src/instant-eval.config.ts:10`                                                  |

Anything else instant-eval needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token                 | Module                                                    |
| --------------- | --------------------- | --------------------------------------------------------- |
| `analytics`     | `AnalyticsApi`        | [analytics](../analytics/README.md)                       |
| `authz`         | `AuthzApi`            | [authz](../authz/README.md)                               |
| `featureFlags`  | `FeatureFlagApi`      | [feature-flag](../feature-flag/README.md)                 |
| `gateway`       | `GatewayApi`          | [gateway](../gateway/README.md)                           |
| `judges`        | `InstantEvalJudgeApi` | [instant-eval-judge](../instant-eval-judge/README.md)     |
| `licensing`     | `LicensingApi`        | [licensing](../../enterprise/modules/licensing/README.md) |
| `organizations` | `OrganizationApi`     | [organization](../organization/README.md)                 |
| `plans`         | `EntitlementApi`      | [entitlement](../entitlement/README.md)                   |
| `projects`      | `ProjectApi`          | [project](../project/README.md)                           |
| `traces`        | `TraceApi`            | [trace](../trace/README.md)                               |

## Who depends on instant-eval

[analytics](../analytics/README.md), [licensing](../../enterprise/modules/licensing/README.md), [ops](../ops/README.md), [trace](../trace/README.md) (as a peer).

<!-- readme:generated:end -->
