# enterprise-ops

Operator views over Enterprise subjects: issued licences and their seats and bindings. Each operation admits LangWatch Cloud admin staff through `OpsApi`, then forwards to the owning module's `*Api`.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Classification | enterprise (`modules/catalogue.json`)                                                                                            |
| Subjects       | enterprise-ops                                                                                                                   |
| Halves         | [contract](contract) · [process](process/README.md)                                                                              |
| Api token      | `EnterpriseOpsApi` = `moduleApi<EnterpriseOpsApi>()("enterprise-ops")`, `contract/src/enterprise-ops.api.ts:122` (15 operations) |
| Installed by   | api, worker, tasks (process)                                                                                                     |

## What enterprise-ops owns

No table, store, secret or config: enterprise-ops declares none.

Anything else enterprise-ops needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name        | Token          | Module                                            |
| ----------- | -------------- | ------------------------------------------------- |
| `auditLog`  | `AuditLogApi`  | [audit-log](../../../modules/audit-log/README.md) |
| `licensing` | `LicensingApi` | [licensing](../licensing/README.md)               |
| `ops`       | `OpsApi`       | [ops](../../../modules/ops/README.md)             |

## Who depends on enterprise-ops

No module names enterprise-ops as a peer.

<!-- readme:generated:end -->
