# @langwatch/system-migrations

In-place, one-time data migrations the system runs on itself — no operator,
no script, no downtime. A leased runner hosted in the worker process walks
every tenant at boot and drives each registered `SystemMigration` through a
per-tenant state machine:

```
pending ──► migrated ──► finalized      finalized = the one-way latch the
  │             ▲                       app keys behaviour changes on
  │             │ proof failed - held, behaviour unchanged
  └──► parked ──┘ errored - retried on a later pass
```

The properties the contract guarantees:

- **One driver fleet-wide.** A lease (Redis in the app) admits one process
  per pass; everyone else stands down. Losing the lease mid-pass just ends
  the pass early — migrations are idempotent by contract.
- **Self-hosted migrates silently.** The cohort predicate is composition:
  self-hosted answers true for every tenant; cloud reads a rollout cohort
  from the environment and widens it deliberately.
- **Finalization is proved, not assumed.** A migration returns `finalized`
  only when it verified the tenant behaves identically without its legacy
  path; disagreements hold the tenant (`migrated`) with a report, and later
  passes re-verify — a held tenant heals itself once the gap is fixed.
- **Failure is parked, never fatal.** One broken tenant cannot stop the
  fleet, and nothing here has a customer-facing failure surface: every
  failure mode leaves the legacy path answering exactly as before.

Storage-engine-free: the app implements `SystemMigrationStateRepository`
(Prisma), `MigrationLeaseRepository` (Redis) and `TenantSource`
(Organization table). Riders live beside the domain they migrate — the
first is the ADR-092 stage-B authorization backfill in
`@langwatch/authz-server`; the identity program's D01 Account backfill is
the expected second.

Spec: `specs/rbac/in-place-authz-migration.feature`. Delivery plan:
`dev/docs/plans/adr-092-authz-delivery-plan.md` (runbook rows M1/M2).
