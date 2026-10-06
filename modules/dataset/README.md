# dataset

Datasets and their records: creating, naming, mapping and reading them by slug or id.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| Classification | core (`modules/catalogue.json`)                                                                        |
| Subjects       | dataset, dataset-record                                                                                |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser) · [client](client)            |
| Api token      | `DatasetApi` = `moduleApi<DatasetApi>()("dataset")`, `contract/src/dataset.api.ts:174` (38 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                             |

## What dataset owns

| Kind            | Name                        | Declared at                                                                     |
| --------------- | --------------------------- | ------------------------------------------------------------------------------- |
| Postgres table  | `BatchEvaluation`           | `process/src/repositories/prisma/prisma.batch-evaluation.repository.ts:19`      |
| Postgres table  | `Dataset`                   | `process/src/repositories/prisma/prisma.dataset-content.repository.ts:60`       |
| Postgres table  | `DatasetRecord`             | `process/src/repositories/prisma/prisma.dataset-content.repository.ts:60`       |
| Postgres table  | `Dataset`                   | `process/src/repositories/prisma/prisma.dataset-count.repository.ts:8`          |
| Postgres table  | `DatasetRecord`             | `process/src/repositories/prisma/prisma.dataset-count.repository.ts:8`          |
| Postgres table  | `BatchEvaluation`           | `process/src/repositories/prisma/prisma.dataset-count.repository.ts:8`          |
| Postgres table  | `DatasetRecord`             | `process/src/repositories/prisma/prisma.dataset-record-content.repository.ts:8` |
| Postgres table  | `DatasetRecord`             | `process/src/repositories/prisma/prisma.dataset-record.repository.ts:19`        |
| Postgres table  | `Dataset`                   | `process/src/repositories/prisma/prisma.dataset.repository.ts:24`               |
| Postgres table  | `DatasetRecord`             | `process/src/repositories/prisma/prisma.dataset.repository.ts:24`               |
| Stores required | prisma, objectStorage       | `process/src/repositories/prisma/prisma.dataset.repositories.ts:25`             |
| Config          | `publicBaseUrl` (BASE_HOST) | `contract/src/dataset.api.ts:178`                                               |

Anything else dataset needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token             | Module                                      |
| --------------- | ----------------- | ------------------------------------------- |
| `entitlement`   | `EntitlementApi`  | [entitlement](../entitlement/README.md)     |
| `experiments`   | `ExperimentApi`   | [experiment](../experiment/README.md)       |
| `permissions`   | `AuthzApi`        | [authz](../authz/README.md)                 |
| `projects`      | `ProjectApi`      | [project](../project/README.md)             |
| `storedObjects` | `StoredObjectApi` | [stored-object](../stored-object/README.md) |

## Who depends on dataset

[audit-log](../audit-log/README.md), [automation](../automation/README.md), [evaluation](../evaluation/README.md), [experiment](../experiment/README.md), [langy](../langy/README.md), [onboarding](../onboarding/README.md), [ops](../ops/README.md), [workflow](../workflow/README.md) (as a peer).

<!-- readme:generated:end -->
