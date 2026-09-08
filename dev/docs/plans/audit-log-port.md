# The audit log behind one port

**Date:** 2026-09-08 · **Landed:** `008a5cd882` · **Owner lane:** Fable

## Shape

```
packages/features/audit-log/contract        OSS   AuditLogApi { record, listEntityHistory }, entry schema
packages/enterprise/features/audit-log      ENT   AuditLogApp, Prisma + memory repositories, id migration
packages/audit-log-null                     OSS   NullAuditLog: record is a no-op, history is []
packages/enterprise/composition/{api,worker} ENT  EnterpriseApiAuditLog / EnterpriseWorkerAuditLog boot the real one
apps/api, apps/worker                             boot the enterprise recorder over their own connection;
                                                  the null recorder answers only a process with no database
```

No event bus. The feature API token is the dependency inversion; a second consumer of audit
facts, if one ever appears, subscribes through eventing to the enterprise feature's own events.

## Writers moved onto `record()`

ops queue audit, ops process audit, ops scheduler audit, the worker ops audit sink, and the
evaluator change history (a read, onto `listEntityHistory`).

## Left on Prisma: the port cannot express them yet (decision needed)

| Site | Needs |
| --- | --- |
| `gateway/server/.../prisma.gateway-audit.repository.ts:70` | `before` / `after` columns, caller's transaction client |
| `organization/server/.../prisma.organization.repository.ts:223` | `before` / `after`, inside `$transaction` with the Project update |
| `enterprise/governance/.../prisma.ingestion-template.repository.ts:95,133,175` | atomic with the template write |
| `enterprise/governance/.../prisma.admin-workspace-view-audit.repository.ts:82` | the written row's `id` and `createdAt` back |
| `authz/server/.../prisma.authz-audit.repository.ts:49` | `createMany` with caller-supplied ids, `skipDuplicates` |
| `authz/server/.../eventing.authz-ledger.adapter.ts:200` | batch with explicit `createdAt` |

Reads still on Prisma: ops process and scheduler history (cross-project, `targetKind` filter),
project recent items (several prefixes, `userId`), the organization audit-log screen (paged,
filtered, counted), governance workspace-view dedupe probe.

**Options.** (1) Widen `record` with optional `before`, `after`, `id`, `createdAt` and add
`recordMany`; accept that the audit row is written after the owning transaction commits, so a
failed write logs and does not roll the change back. (2) Keep those six on Prisma inside the
enterprise boundary by moving each into the enterprise audit-log package as a repository method
the owning feature calls through a second port. Recommendation: (1) for the four single-row
writers, (2) is not worth a second port; the two `createMany` sites in authz are the audit
ledger's own storage and can stay where they are with a comment saying so.

## Product question (Alex)

Does an OSS install keep a working audit log? As landed, the api and worker always boot the
enterprise recorder, so behaviour is unchanged everywhere. The null recorder exists for a
process with no database. If OSS should record nothing, the boot line in
`api-production.composition.ts` and `worker-foundation-apps.composition.ts` selects by licence.
The evaluator change-history panel is the one surface already reading through the port; the
organization audit-log screen and the recent-items strip still read Prisma directly.

## Structural

- `feature-catalogue` allows one root per feature; audit-log now has a core contract and an
  enterprise server. The enterprise root is unregistered. Either the rule admits a split feature
  or the contract moves under `packages/enterprise/features/audit-log/contract` and the OSS
  processes depend on an enterprise contract package.
- `packages/audit-log-null` lives outside `packages/features` because `packages/features/*/*`
  admits only `contract`, `server`, `web`.
- The moved migration carries `feature-source-layout`, `feature-module-classes`,
  `cognitive-complexity` and `temporal-only` findings it always had; no baseline entry under
  either path.
