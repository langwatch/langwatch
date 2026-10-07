# feature-flag

Feature flags: evaluation, operator administration and the browser's authorized reads, sharing one registry, targeting rules and cache invalidation; also experiment enrolment.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Classification | core (`modules/catalogue.json`)                                                                                          |
| Subjects       | feature-flag                                                                                                             |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                                                 |
| Api token      | `FeatureFlagApi` = `moduleApi<FeatureFlagApi>()("feature-flag")`, `contract/src/feature-flag.api.ts:138` (16 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                                               |

## What feature-flag owns

| Kind           | Name                                                                                                                                                                                                                                                               | Declared at                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Postgres table | `FeatureFlagExperimentSetting`                                                                                                                                                                                                                                     | `process/src/repositories/prisma/prisma.feature-flag-experiment-setting.repository.ts:22` |
| Postgres table | `FeatureFlag`                                                                                                                                                                                                                                                      | `process/src/repositories/prisma/prisma.feature-flag.repository.ts:29`                    |
| Config         | `forceEnable` (FEATURE_FLAG_FORCE_ENABLE), `overrides` (≈ `Object.fromEntries( FEATURE_FLAGS.filter(isEnvOverridable).map((definition) => [ definiti…`), `legacy` (≈ `Object.fromEntries( FEATURE_FLAGS.flatMap((definition: FeatureFlagDefinition) => definiti…`) | `contract/src/feature-flag.config.ts:56`                                                  |

Anything else feature-flag needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token             | Module                                    |
| --------------- | ----------------- | ----------------------------------------- |
| `organizations` | `OrganizationApi` | [organization](../organization/README.md) |
| `permissions`   | `AuthzApi`        | [authz](../authz/README.md)               |

## Who depends on feature-flag

[agent](../agent/README.md), [analytics](../analytics/README.md), [auth](../auth/README.md), [data-privacy](../data-privacy/README.md), [evaluation](../evaluation/README.md), [gateway](../gateway/README.md), [governance](../../enterprise/modules/governance/README.md), [instant-eval](../instant-eval/README.md), [langy](../langy/README.md), [monitor](../monitor/README.md), [ops](../ops/README.md), [scenario](../scenario/README.md), [sso](../../enterprise/modules/sso/README.md), [suite](../suite/README.md), [trace](../trace/README.md) (as a peer).

<!-- readme:generated:end -->
