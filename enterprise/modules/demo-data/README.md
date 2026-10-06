# demo-data

The demo instance's seeding: one run over an allowlisted demo organisation.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| Classification | enterprise (`modules/catalogue.json`)                                                                        |
| Subjects       | demo-data                                                                                                    |
| Halves         | [contract](contract) · [process](process)                                                                    |
| Api token      | `DemoDataApi` = `moduleApi<DemoDataApi>()("demo-data")`, `contract/src/demo-data-report.ts:41` (1 operation) |
| Installed by   | api, worker, tasks (process)                                                                                 |

## What demo-data owns

| Kind   | Name                        | Declared at                           |
| ------ | --------------------------- | ------------------------------------- |
| Config | `demoOrgIds` (DEMO_ORG_IDS) | `contract/src/demo-data-report.ts:45` |

Anything else demo-data needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token             | Module                                                  |
| --------------- | ----------------- | ------------------------------------------------------- |
| `organizations` | `OrganizationApi` | [organization](../../../modules/organization/README.md) |

## Who depends on demo-data

No module names demo-data as a peer.

<!-- readme:generated:end -->
