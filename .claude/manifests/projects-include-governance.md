# Project listings hide the governance project by default

Model: opus 5.5 medium (`lane-opus-medium`). Why: one contract flag plus a per-caller audit against main.

## Ruling (Alex, 2026-09-28)
Each organization's hidden `kind = "internal_governance"` project (the tenant governance ingestion lands in)
is hidden from every listing by default, as on main ("every listing surface excludes kind=internal_governance",
origin/main platform/app/ee/governance/services/pullers/pulledUsageRecord.ts:325). Add an optional
`includeGovernance` input (default false) to the project listing operation(s) on `ProjectApi`
(`listByOrganization` and any sibling org/team listing) — NOT a new operation.

## Work
1. Contract: optional `includeGovernance?: boolean` on the listing input schema(s); default hides.
2. Repository/service: filter `kind: { not: "internal_governance" }` unless includeGovernance.
3. Audit EVERY caller of the listing op(s) (~10 modules). For each, find main's equivalent query
   (`git grep -n internal_governance origin/main`, and the caller's main counterpart) and decide:
   main includes the governance project -> pass `includeGovernance: true` (e.g. data-retention org scope);
   main excludes or never saw it -> leave the default. Put the per-caller table in the handoff.
4. GET /api/projects then matches main (5 projects in apidiff r45, not 6).
5. Spec scenarios (project module specs) for default-hidden and opt-in, bound to tests; a test proving
   data retention still covers the governance project.

## Rules
Shared checkout; touch only what this needs. Never git stash, never commit, never pnpm install, never read
.env, never spawn subagents, no `as` casts, comments <= 5 lines. Editing enterprise/modules/governance is NOT
allowed — if a governance caller needs the flag, list it in the handoff instead. Scoped format + lint +
typecheck + tests per touched package, plus the api/worker installation tests. Use tslsp for call sites.
Test DB: LANGWATCH_TEST_DATABASE_URL="postgresql://$(whoami)@localhost:5432/lw_r53_langy_test?schema=langwatch_db".
Handoff: .claude/handoffs/projects-include-governance.md with every file touched.
