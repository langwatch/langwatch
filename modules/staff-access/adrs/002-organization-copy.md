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
`opsCopy:create` and answered only for a session approved with the `ops:copy`
scope.

- **Two approvals, one per organization.** The bearer is the target session
  (`ops:copy` and `org:support`); the body carries the source session's ops
  token (`ops:copy` and `org:content`). Both must be live, redeemed by the same
  enrolled agent of the same operator, pinned to the same address, and name
  different organizations. Each approval needs the organization's name typed.
- **Trail and audit first.** Before anything is made, each session gets a trail
  row and each organization's audit log gets a `staffAccess.orgCopy` row with
  the approver, the reason and the planned items. A failed write copies
  nothing.
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
  new ones. A dry run plans and writes nothing.

## Consequences

The copy runs inside the request. A very large source organization can outrun
the request timeout; a rerun continues where the ledger stopped. Workflows,
scenarios, agents, dashboards, triggers and ClickHouse data (traces, runs) are
specified as `@unimplemented` and need their owners' APIs first.
