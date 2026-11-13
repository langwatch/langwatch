# ADR-002: Staff copy an organization's setup through two approvals

**Status:** Accepted

**Behaviour:** [Organization copy](../specs/staff-access-org-copy.feature).
Builds on [ADR-001](./001-package-boundary.md) and
[ADR-193](../../../dev/docs/adr/193-ops-agent-access.md).

## Context

Staff set up demo organizations for prospects by copying projects from an
existing organization. Without a server operation this needs database access or
scripts, which leave no trail in either organization and skip every owner's
rules.

## Decision

The copy is an ops operation of the `staff-access` module:
`POST /api/staff-access/ops/copies`, asked as the platform permission
`opsCopy:create` and answered only for a session approved with the
`copy:target` scope.

- **Two approvals, one per organization, each naming the other.** A copy side
  is its own scope, approved alone: `copy:source` on the source organization
  and `copy:target` on the target. Each request names its organization and the
  other organization of the copy (`counterpartOrganization`). The approval page
  shows the direction ("From ACME into Globex") and the passkey signs the other
  organization, so a live session pairs only with the copy it was approved
  for. The bearer is the target session; the body carries the source session's
  ops token. Both must be live, redeemed by the same enrolled agent of the same
  operator, pinned to the same address, and name each other. Each approval
  needs the organization's name typed.
- **The target grant is signed.** `copy:target` grants exactly what a copy
  creates (`STAFF_COPY_TARGET_PERMISSIONS`: `project:create`,
  `evaluations:create`, `evaluations:update`, `prompts:create`,
  `prompts:update`, `datasets:create`). The approval page lists it, the
  passkey signs it, and the run checks each item against it before making it;
  an item outside the grant is skipped with `outside_copy_grant`.
- **No organization key.** Copy scopes are platform scopes: redeeming either
  side answers only an ops token. The server reads the source itself through
  the owners' APIs, so the agent never holds a key that reads the source's
  traces.
- **Trail and audit first.** Before anything is made, each session gets a trail
  row and each organization's audit log gets a row with the approver, the
  reason and the planned items: `staffAccess.orgCopyPlanned` on a dry run,
  `staffAccess.orgCopy` before a real run (which also records that copied
  monitors start paused). A failed write copies nothing. The source ops token
  is never written to a trail row, an audit row or an answer.
- **A revoke stops a running copy.** Before each item the run rereads both
  approvals. Once either is revoked, lapsed or ended, nothing more is made,
  the remaining items are reported `stopped`, the report says why, and both
  audit logs get a `staffAccess.orgCopyStopped` row with what was made.
- **An allowlist.** A copy carries projects, evaluators, monitors (paused),
  prompts with every version, and ready datasets. It never carries secrets,
  API keys, model providers, members, roles, SSO, billing, licence or usage.
  A kind not on the list is not read at all.
- **Owners' APIs only.** Each kind is read and created through its owner's
  `*Api` (`ProjectApi`, `EvaluatorApi`, `MonitorApi`, `PromptApi`,
  `DatasetApi`, `OrganizationApi`). The copy uses plain create operations, not
  the owners' lineage copy operations, so no row in the target points back at
  the source organization.
- **Idempotent by a ledger.** `StaffAccessCopyLedger` records each source item
  and the target item made from it, unique on target organization, kind and
  source id. A rerun reports earlier items as `already_copied` and makes only
  new ones. A dry run plans and creates nothing.

## Consequences

The copy runs inside the request. A very large source organization can outrun
the request timeout; a rerun continues where the ledger stopped. Workflows,
scenarios, agents, dashboards, triggers and ClickHouse data (traces, runs) are
specified as `@unimplemented` and need their owners' APIs first.
