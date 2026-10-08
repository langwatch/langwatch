# audit-log

The audit log: every module records who did what through it, and an entity's history is read back from it.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| Classification | core (`modules/catalogue.json`)                                                                        |
| Subjects       | audit-log                                                                                              |
| Halves         | [contract](contract) · [process](process/README.md)                                                    |
| Api token      | `AuditLogApi` = `moduleApi<AuditLogApi>()("audit-log")`, `contract/src/audit-log.ts:90` (4 operations) |
| Other token    | `AuditLogHomeApi`, `process/src/transport/home.trpc.ts:14`                                             |
| Installed by   | api, worker, tasks (process)                                                                           |

## What audit-log owns

| Kind           | Name       | Declared at                                                            |
| -------------- | ---------- | ---------------------------------------------------------------------- |
| Postgres table | `AuditLog` | `process/src/repositories/prisma/prisma.audit-log.repository.ts:52`    |
| Postgres table | `AuditLog` | `process/src/repositories/prisma/prisma.recent-touch.repository.ts:12` |

Anything else audit-log needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

None: audit-log declares no peers.

## Who depends on audit-log

[agent](../agent/README.md), [auth](../auth/README.md), [automation](../automation/README.md), [coding-agent](../coding-agent/README.md), [enterprise-ops](../../enterprise/modules/enterprise-ops/README.md), [evaluator](../evaluator/README.md), [github](../github/README.md), [governance](../../enterprise/modules/governance/README.md), [identity](../identity/README.md), [ops](../ops/README.md), [project](../project/README.md), [scenario](../scenario/README.md), [scim](../../enterprise/modules/scim/README.md), [sso](../../enterprise/modules/sso/README.md) (as a peer).

<!-- readme:generated:end -->
