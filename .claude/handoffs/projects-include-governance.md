# Handoff: projects-include-governance

Status: review
Manifest: .claude/manifests/projects-include-governance.md
Updated: 2026-09-28 02:15

## 1. Identity

First lane on this task (opus 5.5 medium). Attempt 1.

## 2. Objective

Hide each organization's `kind = "internal_governance"` project from ProjectApi listings by default,
with an optional `includeGovernance` input on the existing listing ops; audit every caller against main.

## 3. Owned paths

Per manifest: the project module, plus the caller files the audit needs. enterprise/modules/governance
excluded.

## 4. Shared paths - do not edit

enterprise/modules/governance (untouched).

## 5. Work completed

- `ProjectApi.listByOrganization` and `ProjectApi.listByTeam` take optional `includeGovernance`
  (`projectPaginationSchema` gains `includeGovernance: z.boolean().optional()`). Default hides the
  governance project in prisma + memory repositories. `listByOrganization` gains the filter (it had none);
  `listByTeam` already hid it and now can opt in. No new operation.
- GET /api/projects (project.rest.ts:168) uses the default, so it now matches main's
  `findAllByOrganization` (main project.prisma.repository.ts:246 filters the kind). Not re-run live in apidiff.
- Callers where main includes the governance project now pass `includeGovernance: true` (table below).
- `OrganizationApi.listProjectsByOrganization` (a forwarder onto listByOrganization) input gains the same
  optional field so billing can opt in.

Per-caller audit (main counterpart -> decision):

| Caller | Main counterpart | Decision |
|---|---|---|
| project.rest.ts:168 GET /api/projects | project.prisma.repository.ts:246 excludes | default (hidden) |
| data-retention.service findAffectedProjectIds ORG | dataRetentionPolicy.repository.ts:175 no kind filter | `true` |
| data-retention.service findAffectedProjectIds TEAM (listByTeam) | same, `{ teamId }` no kind filter | `true` |
| ops-checkup.service findOldestProjects | checkup.deps.ts:85 firstProjectOf no filter | `true` |
| model-provider-scope getOrganizationSystemReference (x2) | modelProvider.service.ts:686 all team projects | `true` |
| api-key-cli.service scope summary | cli-login-key.service.ts:586 no kind filter | `true` |
| coding-agent PR-mapping backfill | presets.ts:1832 findProjectIds no kind filter | `true` (restated type widened) |
| billing connected-customer-facts findProjectIds (via organization.listProjectsByOrganization) | monthlyStatement.prisma.ts:86 no kind filter | `true` |
| api-key-catalog getOrgProjects | api-key.repository.ts:684 findProjectsInOrg excludes | default |
| analytics langwatch-ql-query-scope readableProjects | lwql/readableProjects.ts:115 excludes | default |
| coding-agent-scope-directory page | resolveCallerProjectScope.ts:112 excludes | default |
| organization.app listTeamsWithProjects / listTeamAccessMatrix | organization.prisma.repository.ts:855 excludes | default |
| organization team.rest listProjectsByTeam | team.prisma.repository.ts:49 excludes | default (unchanged) |
| agent connected-agent-credential refusal meta (project_required) | no main query found; customer-visible list | default |
| governance ai-tool-provider-reach listByTeam | not editable; listByTeam already hid it | unchanged behaviour |

## 6. Files changed

project: contract/src/project.ts (M), contract/src/project.api.ts (M), process/src/app/project.app.ts (M),
process/src/services/project.service.ts (M), process/src/repositories/project.repository.ts (M),
process/src/repositories/prisma/prisma.project.repository.ts (M),
process/src/repositories/memory/memory.project.repository.ts (M),
process/src/repositories/memory/__tests__/memory.project.repository.unit.test.ts (M),
process/src/repositories/prisma/__tests__/prisma.project.repository.unit.test.ts (M),
specs/project-service.feature (M, 2 @unit scenarios)
data-retention: process/src/services/data-retention.service.ts (M),
process/src/services/__tests__/data-retention.service.unit.test.ts (M), specs/data-retention-service.feature (M)
ops: process/src/services/ops-checkup.service.ts (M)
model-provider: process/src/services/model-provider-scope.service.ts (M)
api-key: process/src/services/api-key-cli.service.ts (M)
coding-agent: process/src/services/coding-agent-pull-request-mapping-backfill.service.ts (M)
organization: contract/src/organization.api.ts (M), process/src/app/organization.app.ts (M)
enterprise/modules/billing: process/src/services/connected-customer-facts.service.ts (M)

## 7. Checks completed

- oxfmt --write on the 18 .ts files -> 18 files; oxlint --type-aware on same -> exit 0
- typecheck: project-contract, project-process, data-retention-process, ops-process, model-provider-process,
  api-key-process, coding-agent-process, organization-contract, organization-process,
  enterprise-billing-process -> all clean
- project-process test src/repositories src/services -> 89 passed
- data-retention-process data-retention.service.unit.test.ts -> 8 passed
- ops ops-checkup 10, model-provider 349, api-key api-key-cli 11, coding-agent backfill 2, billing
  connected-customer-facts 5, organization-process 181 -> all passed
- platform-api api-installation.integration.test.ts -> 11 passed
- worker test:integration worker-installation.integration.test.ts -> 5 passed
- check:feature-parity: project-service.feature 5/5 bound, data-retention-service.feature 18/18 bound
  (whole-tree run fails on pre-existing debt, not these files)

## 8. Current failure

none

## 9. Exact next action

Coordinator: review the diff of the 20 files in section 6, then re-run apidiff GET /api/projects and confirm
5 projects (was 6 in r45).

## 10. Shared-file requests

none

## 11. Risks

- OrganizationApi.listProjectsByOrganization input widened with the same optional flag (not a new op) so
  billing can match main; confirm this is within the ruling.
- listIdsByOrganization NOT changed: it returns every project id incl. archived and governance; its
  callers (gateway, entitlement, trace usage, prompt, instant-eval, annotation backfill, ops usage report,
  organization, governance cost summary/reach) use it as a tenant-id set, which on main includes governance.
  Hiding it by default would break governance callers this lane may not edit.
- Data retention on main also includes ARCHIVED projects in findAffectedProjectIds; ours still skips archived
  (pre-existing divergence, not fixed; would need another flag).
- Agent refusal meta caller: no main counterpart located; left hidden as a customer-visible list.
- Sabotage check not run explicitly; the governance tests assert the governance id present/absent directly.

## 12. Unfinished work

1. Live apidiff confirmation of GET /api/projects count.
2. Decide whether data retention should also cover archived projects (main does).

## 13. Completion status

Objective landed and independently committable; backed by scoped typecheck, unit, installation and parity checks.
