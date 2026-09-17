# PR #7633: one-PR cleanup plan

Keep the complete feature in [PR #7633](https://github.com/langwatch/langwatch/pull/7633). Reduce duplicated decisions, queries, setup and prose while preserving its public contracts and security boundaries. Deliver the work as small commits within this PR.

Constraint: no Prisma relations. Express associations through scalar IDs and explicit scoped queries inside repositories. Do not add relation fields, foreign keys or schema migrations to support this cleanup.

Reviewed head: `0a3b94e524ce928e488b9ff11f6f766ae7083c53`.
Base: `3d3dc1042097e8433e217ad88c833db7f46226be`.
All source paths and line numbers below refer to that head, which predates the current checkout's `modules/` layout. This plan does not include a repository-wide architecture conversion.

## What exists now

The diff contains 580 files, 95,509 additions and 8,368 deletions. Approximately 40,013 added lines are tests/fixtures and 4,617 are behavioral specs. The identity repository directory contains 47 production files, 17 with SSO names; these totals include code already in the base.

The main cleanup opportunity is visible in this request path:

```text
ssoSetup router: 18 calls to ssoSelfServe()
  -> constructs SsoSelfServeService and its collaborators per call
     -> setup/progress: PrismaSsoMigrationProgressRepository
     -> finalization service
        -> PrismaSsoMigrationFinalizationRepository
           -> another PrismaSsoMigrationProgressRepository
           -> re-reads connection and membership evidence
        -> legacy retirement and guarded connection commands
```

`sso-self-serve.service.ts` is 1,862 lines with 19 public operations; roughly 584 lines begin with comment syntax. The progress and finalization repositories together are 1,072 lines. A lexical scan of added production TypeScript found 12,732 comment-like lines across the PR. Those counts identify reading cost, not a deletion quota.

## Review results and baseline limits

Independent reviews covered security, feature behavior, and code quality/hygiene. The coordinator traced repository ownership and composition. Evidence is from source, schema, tests and caller paths at the exact PR head; the suspected failures below have not been executed against a live deployment.

- `git diff --check` against the PR base passes.
- The identity-function and same-name-delegation ast-grep detectors report zero matches over the extracted identity server and app-layer source. There is no evidence for a blanket pass-through-class purge.
- A focused inventory found 802 scenarios in changed identity specs: 782 enforced titles found in test annotations and 20 explicitly `@unimplemented`. This is not a feature-parity run or proof that the annotations bind appropriate behavioral tests.
- Historical package tests, typechecks, full parity, and application lint were not run for this plan. The current checkout is a different, heavily modified branch; its results would not validate this PR. The current architecture-enforcer package is absent at this PR head.

## Problems to fix before structural cleanup

### 1. Finalization contains the same schema mistake already fixed in progress

**P1, REAL GAP; R8, duplicated evidence queries.**
`platform/app/src/server/app-layer/identity/repositories/sso-migration-finalization.prisma.repository.ts:304` queries `organizationUser.count({ user: { identifiers: ... } })`. The head's `User` model has no `identifiers` relation (`platform/app/prisma/schema.prisma:176`); `Identifier` stores a bare `userId`.

This is reached by `inspect -> readOperationalEvidence -> legacyAccounts -> verifiedDirectMemberCount`. The sibling progress read correctly loads identifiers first at `sso-migration-progress.prisma.repository.ts:503`. Its schema regression test explicitly documents this failure, but covers only progress.

Fix the query by reading matching `Identifier.userId` values and counting the organization's memberships against those IDs, using explicit queries rather than a Prisma relation. Test finalization against actual Prisma validation. Then give the shared membership evidence one owner. Preserve the different meanings of linked identifiers (`LIVE_IDENTIFIER_STATES`) and verified replacement identifiers (`VERIFIED`/`PRIMARY`).

### 2. New SSO/recovery flows need integration with the existing credential guard

**P1, REAL GAP at the integration boundary; inherited guard logic.**
`platform/app/src/server/better-auth/config/request-hooks.ts:287` skips organization credential enforcement when `deploymentIsFederationCapable()` is false; `signin-method-policy.ts:120` defines that as `NEXTAUTH_PROVIDER === "email"`. Per-connection SSO is mounted independently at `config/plugins.ts:189`. The static path therefore permits an existing-password member of an active SSO organization to use local sign-in/reset on an email-default deployment.

Conversely, `request-hooks.ts:182` rejects all governed-address credential requests in a mixed deployment, including a named emergency-access holder. `runtime.ts:632` asks the sign-in router without recovery context; `local=1` changes the picker, not server authorization. The new binding can satisfy activation without making that credential request succeed.

The guard logic predates this PR. Treat these as integration gaps exposed by the new self-service/recovery paths, not newly written guard regressions. Establish them with mounted-auth tests before changing policy. Use one credential-authorization decision that accounts for deployment policy, organization SSO and server-verified recovery eligibility. A client URL flag must never grant access.

Required matrix: email-default and mixed deployments; governed and ordinary addresses; regular member and named recovery holder; live, expired and revoked grants. Observe credential refusal/reset issuance/session creation through the real handler.

### 3. Migration controls and pagination disagree with the backend

**P2, REAL GAP; duplicated readiness decisions.**
`platform/app/src/components/settings/SingleSignOnSetup.tsx:404` hides route changes only at `FINALIZED`, so rollback remains offered during `FINALIZING`. Line 410 enables switching after test sign-in alone. The guards require an active connection and lock route changes during finalization (`packages/identity-server/src/sso-connection-guards.ts:135,410`).

Expose action readiness from the migration policy/view and render it consistently, while retaining server enforcement. Wire the existing `ssoSetup.getMigrationProgress` pagination into `Stragglers`: `getSetup` supplies only 25 rows (`sso-self-serve.service.ts:618`), and the UI ignores `members.nextCursor` (`SingleSignOnSetup.tsx:398,469`). Test more than 25 members and interrupted finalization.

## Structural cleanup, in order

### A. Remove dead dependencies and false optionality

- **STALE, R5/R8:** `SsoSelfServeServiceDeps.license` at `sso-self-serve.service.ts:572` is never read. Remove the field, its runtime argument at `runtime.ts:881`, and fixture-only provision. Keep `InstanceLicenseProof`: the context resolver still uses it to check entitlement.
- **STALE, R5:** `migrations?` and `finalization?` at lines 585–589 describe an expand rollout, but the only production constructor supplies both (`runtime.ts:912–937`). Make them required and remove the silent-null/not-composed branches. Update fixtures to provide explicit collaborators.
- **STALE, R5:** `sso-migration-progress.prisma.repository.ts:272` defaults the password check to `async () => true`, directly contradicting its comment. Production already supplies the real credential lookup. Require it.
- Construct one migration evidence collaborator and reuse it. Replace repeated per-request construction with the branch's explicit process composition, keeping per-organization flags and mutable entitlement reads evaluated at request time. Do not cache authorization answers as part of this change.

### B. Give migration evidence one persistence owner

**R1/R8.** Progress constructs a customer-facing view inside a repository. Finalization depends on that concrete repository, builds the view with a one-row page, and then re-reads much of its evidence (`sso-migration-finalization.prisma.repository.ts:35–85`).

Replace those overlapping implementations with one migration evidence repository returning typed stored facts, using explicit ID-based queries without Prisma relations. Build progress/readiness and finalization decisions from those facts. Finalization must still obtain fresh evidence at its existing safety checkpoints; sharing query code does not permit reusing a stale UI snapshot.

Proposed responsibility split, with rough review budgets rather than promised sizes:

```text
packages/identity-server/src/
  sso-migration-evidence.ts                 typed facts + repository boundary
  sso-migration.rules.ts                    pure progress/blocker mapping (~150–250 lines)
  sso-migration-finalization.service.ts     existing ordering/retry coordinator
  sso-self-serve.service.ts                 setup and command orchestration
platform/app/src/server/app-layer/identity/repositories/
  sso-migration.prisma.repository.ts        common evidence queries (~450–650 lines)
  sso-migration-callback-policy...          preserve callback authorization boundary
  sso-migration-legacy-retirement...        preserve destructive-write boundary
```

These replace the old progress/finalization read implementations; do not retain compatibility wrappers. Preserve organization scope, account provenance, cursor ordering, time units, response fields and distinct identifier-state predicates. Keep destructive retirement, callback authorization and transaction locks separate even where they read the same tables.

### C. Simplify the self-serve implementation

After deleting residue and shortening prose, separate any remaining substantial view assembly from command orchestration only where that gives a real collaborator. Moving 1,862 lines into several files alone is not a reduction.

The DNS and HTTPS proof checks repeat pending-proof lookup, normalization, token comparison and guarded completion (`sso-self-serve.service.ts:1451,1527`). Share those common steps with small typed helpers. Keep separate network adapters and distinct absent/unreachable errors; avoid a generic verification framework.

Leave the guarded connection service as the write authority. Preserve the difference between the pre-registration callback address and an existing connection's address, actual sign-in evidence, and organization-bound access checks.

### D. Reuse existing UI primitives and typed role handling

- **R8:** Replace the private 41-line disclosure in `singleSignOn/DomainsSection.tsx:380` with `settings/SettingsDisclosure.tsx:19`; there is one caller and the comment explicitly says the styling matches.
- **R8/type safety:** `access/TeamsAndProjectsSection.tsx:105,1393,1467` rebuilds the same custom-role encoding; mutation inputs then use `as any` at lines 253,372,590. Use one typed option builder/parser. Keep team-seat eligibility distinct from project-grant eligibility.
- **R8, conditional consolidation:** Share the entitlement/loading facts repeated by `access/useEnterpriseLock.ts:18`, `members/TwoStepRequirementCard.tsx:31` and `settings/authentication/SignInSecurityCards.tsx:96`. Preserve each control's ability to turn an existing setting off after plan lapse, its copy, deployment-specific links and loading behavior.
- Implement the migration readiness/pagination fixes above in the same UI pass. Keep URLs, permission distinctions and response compatibility.

### E. Consolidate test setup and shorten narration

**R7/R8.** The self-serve, domain-verification and activation suites duplicate credential stores, proof/discovery stubs and real service/guard/ledger assembly:

- `packages/identity-server/src/__tests__/sso-self-serve.integration.test.ts:89,120,183`
- `packages/identity-server/src/__tests__/sso-domain-verification.integration.test.ts:69,101,155`
- `packages/identity-server/src/__tests__/sso-activation.integration.test.ts:79,155`

Extend existing `support/in-memory-connections` and `support/in-memory-self-serve` with one small typed fixture. Keep all distinct scenarios. Resolve the existing fake-ledger drift explicitly: one deduplicates command IDs, another does not. Sharing a permissive fake is not an improvement.

Replace the bespoke source-text parser in `sso-connection-tenancy-rail.unit.test.ts:45` only after equivalent behavior coverage or an established AST guard proves its invariant. Its 198 lines are not automatically deletable.

Remove comments that restate signatures or recount development history. Keep tenant scope, concurrency, retry/idempotency and trust-boundary explanations. Correct stale statements such as the licence/domain-proof claim at `sso-self-serve.service.ts:71`. Distill the 494-line handover into durable runbook facts and still-open work; preserve unresolved findings. Update the PR's deployment notes to name both added PostgreSQL migrations, including `20260916120000_org_sign_in_security`.

## Keep list

- Cross-package storage/network interfaces and real memory implementations. One implementation in another package is a valid dependency boundary.
- Separate platform-operator reads from tenant-facing reads; sharing a row mapper does not justify exposing cross-tenant queries to ordinary callers.
- Pre-link SSO assertion authorization, exact provider/subject provenance, request-local callback evidence and per-connection issuer trust.
- Organization advisory locks, activation reservations, last-recovery-holder protection and retry-safe retirement. Preserve transaction ordering.
- SCIM organization/connection token checks, ambiguous legacy/new token rejection, directory-owned writes and last-admin safeguards.
- DNS/HTTPS ownership evidence, per-hop pinned egress, SAML signature verification and durable replay reservations.
- Tests at service, persistence, transport and UI boundaries that establish different behavior. Existing security tests are not duplicates merely because they share setup.

## Commits, cost and verification

Keep these commits in the existing PR; each has focused checks and a readable diff.

1. **Characterize and fix blockers — highest risk.** Finalization Prisma regression; mounted credential/recovery matrix; explicit attribution of inherited guard behavior. Prove fixes through the real boundaries.
2. **Delete residue and repeated wiring — small.** Dead licence argument, false optionality, permissive password default and duplicate evidence construction. Run identity package tests/typechecks plus affected app tests.
3. **Unify migration evidence — medium/high.** Characterize complete current view/output, then replace the overlapping repositories. Verify linked/verified distinctions, multi-org accounts, ordering, pagination, fresh finalization checks and PostgreSQL concurrency tests.
4. **Simplify self-serve proof/view code — medium.** Consolidate repeated steps without changing network or command boundaries. Run domain proof, activation and lifecycle suites.
5. **Consolidate UI and finish migration controls — medium.** Typed roles, shared disclosure/entitlement facts, action readiness and pagination. Run focused component tests and browser flows.
6. **Consolidate fixtures, trim prose, update PR facts — small/medium.** Keep scenario coverage and preserve memory-ledger semantics. Re-run affected tests, actual feature parity and final gates.

At implementation start, use an isolated checkout of the PR head and the pinned dependencies. Run both `@langwatch/identity` and `@langwatch/identity-server` test/typecheck scripts, relevant `@langwatch/web` unit/component/PostgreSQL integration suites and `check:feature-parity`. Include application source and test typechecks. Apply the repository-required formatting/static checks to changed paths and report unavailable or failing gates explicitly. Do not run the unrelated current worktree's checks and label the PR green.

The final browser/handler acceptance pass covers fresh OIDC and SAML setup; domain verification; real recovery login after activation; SCIM provisioning/deactivation/token rotation; migration with more than 25 unlinked members; rollback before finalization; finalization retry; and permission-restricted views. Prove the parked brokered-to-direct no-duplicate-account scenario before claiming that flow is complete. Preserve SAML replay coverage, adding a mounted concurrent replay test before modifying its persistence.

## Blast radius and completion criteria

The immediate self-serve production caller is `platform/app/src/server/api/routers/ssoSetup.ts` (18 factory calls). Construction is in `runtime.ts`; self-serve contract types also reach settings UI and test fixtures. The repository consolidation should stay within migration consumers, their package declarations and composition. Credential enforcement touches the shared auth handler and therefore requires the wider deployment/person/grant matrix. Role-option cleanup affects both team and project access forms.

Before changing an exported symbol, enumerate its exact importers at the implementation head. Update consumers directly; do not add compatibility exports to make a move appear smaller.

Completion means: the identified behavior gaps have executable coverage; one owner supplies shared migration evidence; no unused self-serve licence dependency or fictitious migration optionality remains; repeated fixtures/UI primitives are consolidated; public contracts and security invariants remain intact; and checks report their actual results. Record before/after production, test, comment and file counts separately. A net reduction is expected from cleanup commits, but no percentage target justifies weakening behavior or coverage.
