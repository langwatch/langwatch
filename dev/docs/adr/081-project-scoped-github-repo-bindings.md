# ADR-081: Bind GitHub repos to projects via a PROJECT-only scoped-resources table, fail-closed

Date: 2026-07-31
Status: Proposed

> GitHub repo access is bound per-project via a **PROJECT-only scoped-resources junction table** (`LangyGithubRepoBinding` / `LangyGithubRepoBindingScope`), with **fail-closed** minting for bound projects, a **two-phase rollout** that keeps unbound projects on today's behavior until the picker UI ships, and **write-time + mint-time** validation against the installation's actual grant.

## Context

- Issue #790: Langy mints GitHub installation tokens scoped to the *entire* installation's repo set, not the specific repo a turn is working with. Any org with more than one project on different repos is simultaneously over- and under-scoped.
- An earlier attempt (PR #6080, still open and unmerged) added `Project.repositoryFullName String?` — a single nullable column. It can express "1 project → 1 repo" but not "N projects share 1 repo" cleanly at the model level, cannot express a project needing more than one repo at all, and its unset-value fallback is to mint against the full installation — a silent widen, not a denial.
- Real production topology (confirmed, not hypothetical): a project can be 1:1 with a repo, several projects can share one repo (e.g. `staging`/`development`/`production` all pointing at the same app repo), and an org can have several repos in play across its projects. All three must be expressible without a further schema change.
- `dev/docs/best_practices/scoped-resources.md` documents exactly this class of problem and gives a cardinality rule: a resource visible at several scopes *at once* uses a `<Resource>` + `<Resource>Scope` junction. ADR-021 established this pattern; existing junction instances: `ModelProvider`+`ModelProviderScope`, `ModelDefaultConfig`+`ModelDefaultConfigScope`, `VirtualKey`+`VirtualKeyScope`, `RoutingPolicy`+`RoutingPolicyScope`. This ADR adds the 5th.
- `LangyGithubInstallation` (existing, unchanged by this ADR) represents "this LangWatch org connected this GitHub account" — a plain FK to `Organization`. Correctly shaped already: an installation has no org/team/project cardinality question of its own.
- The mint path already supports multi-repo token scoping: `mintScoped({ repositoryIds: string[] })` in `langy-github-installations.service.ts` and GitHub's installation-token API both accept multiple repo ids per token (≤500). This capability was unused, not missing.
- `mintTurnToken` currently takes only `{ organizationId, repositoryFullName? }`. The single production caller (`langy-turn-base-dependencies.ts:65-69` → `LangyCredentialService.getOrProvision`) holds `projectId` but never threads it through, and never passes `repositoryFullName` — so 100% of production mints today take the installation-wide branch. Project-level scoping is impossible without this signature change.
- `LangyCredentialService.getModelsAllowed` (`LangyCredentialService.ts:506-538`) shows the exact idiom to resolve a PROJECT-scoped row: `findFirst({ where: { organizationId, scopes: { some: { scopeType: "PROJECT", scopeId: projectId } } } })`, used today for `VirtualKeyScope`.
- Minted tokens are Redis-cached for 50 minutes under `langy:gh:insttoken:${installationId}:${scopeKey}` (`langyGithubAppToken.ts:28,191`). The scope key hashes the sorted repo-id set, so a changed binding set produces a *different* cache key — a stale cache entry is never served after a binding change. Already-issued tokens, however, stay valid on GitHub's side for their fixed ~1h lifetime; nothing calls GitHub's token-revocation endpoint.

## Decision

1. **New tables, junction shape**: `LangyGithubRepoBinding` (the resource — one row per distinct repo under one installation) and `LangyGithubRepoBindingScope` (the junction — PROJECT-only scope rows). A repo bound to many projects is "one logical resource visible at several scopes," which `scoped-resources.md` says requires the junction shape, not the inline-column shape `GatewayBudget` uses.
2. **Scope levels: PROJECT only.** No `ORGANIZATION`/`TEAM` scope type. An org/team-level row would silently widen every project under it the moment it's created — the exact leak this ADR exists to close. "N projects share a repo" is N independent `PROJECT` scope rows against the same `LangyGithubRepoBinding`, not a shared team/org row.
3. **Single installation per project.** A project's bound repos must all belong to one GitHub installation. Enforced race-safely: binding creation claims via the DB's unique index / an atomic insert-or-get, following the `insertOrGetExisting` pattern already used in this exact service for the cross-tenant installation-takeover guard (`langy-github-installations.service.ts:152-159`) — never a check-then-write across two awaits. If the invariant is ever found violated at mint time anyway, the mint **fails closed** (returns `null`, logs) rather than silently dropping repos from the union. Keeps `LangyCredentials.githubToken` a single string (no downstream contract change) and matches the picker UX — an admin picks from one connected GitHub account's repo list at a time.
4. **`mintTurnToken` gains a required `projectId`.** It resolves the project's bound repo set with the same idiom `getModelsAllowed` already uses for `VirtualKeyScope`, applied to the new table.
5. **Mint semantics (for a project with ≥1 binding):**
   - No explicit `repositoryFullName` on the turn → mint one token scoped to the union of every repo bound to the project (`mintScoped({ repositoryIds: [...] })`). The bound set is the project's declared working set; the existing JIT-narrowing seam (`repoScopeKey`, `langy-github-installations.service.ts:278-280`) remains the future path to per-clone narrowing below the union.
   - Explicit `repositoryFullName` → must be a member of the project's bound set, else deny. Never fall through to the wider union or the installation.
   - All bound repos fail to resolve against the installation's current grant → return `null` (deny), reusing today's "GitHub unconfigured" degrade path (worker shows the connect card).
6. **Two-phase rollout — fail-closed applies to bound projects only, at first.** Phase 1 (this ADR's implementation): a project **with** bindings gets the scoped mint and all the denial rules above; a project **with zero bindings** keeps today's installation-wide mint. Strictly better than today wherever configured, no worse anywhere, and existing customers keep a working GitHub integration on deploy. Phase 2 (named milestone, not an open-ended TODO): once the repo-picker UI has shipped and orgs have had a binding window, the zero-bindings fallback is removed and zero bindings → `null`. The removal is its own PR citing this ADR.
7. **Validation timing: write-time AND mint-time, one listing per mint.** Creating a binding checks the repo is currently in the installation's grant (cached `repositories` list when `repositorySelection="selected"`, live listing when `"all"`). At mint time the installation's repo list is resolved **once** (same cached-or-live rule) and all N bound repos are matched against it in memory — never one lookup per repo. Bound repos that no longer resolve are excluded from the minted set (and logged); this closes the drift window where GitHub revokes a repo after it was bound.
8. **Write permission: `project:manage`.** Same convention as every other `*Scope` table (writing a scope row requires the matching manage-permission on the scope target). Red-team dissent recorded (see Revisions): this permits any project manager in the org to bind any repo the installation reaches. Accepted trade-off — see Consequences.
9. **Installation deletion cascades bindings — intentionally.** The App being uninstalled means the grant is gone, so bindings referencing it are meaningless; `onDelete: Cascade` from `LangyGithubInstallation` enforces the binding ⊆ grant invariant structurally. A reinstall gets a new `installationId` and requires re-binding (see Consequences).
10. **Tenancy registration follows the `ModelProvider` precedent exactly.** `LangyGithubRepoBinding` joins `ORG_TENANCY_EXEMPT` in `dbOrganizationIdProtection.ts` (its primary access path is the scope predicate, which the org guard would reject) and **both** tables get `SCOPED_MODELS` entries in `dbMultiTenancyProtection.ts` mirroring `ModelProvider`/`ModelProviderScope` (`dbMultiTenancyProtection.ts:237-294`): where-clauses require a row id, `organizationId`/parent id, or scope predicate; creates require the scope relation / `(scopeType, scopeId)` payload. The partition test enforces that every org-bearing model is either guarded or listed, so this registration is CI-checked, not convention.
11. **No migration/backfill.** PR #6080 is unmerged and abandoned in favor of this design — nothing has shipped that needs migrating away from. Deliberately no auto-backfill of installation repos into bindings either: that would re-create today's over-scope as permanent explicit config rows admins would have to prune.

## Constants

| Name | Value | Purpose |
|---|---|---|
| Scope enum | `LangyGithubRepoBindingScopeType { PROJECT }` | Per-table enum per convention; single member today, extendable later without a shape change |
| Write permission | `project:manage` | Matches existing `*Scope` table convention (user-confirmed over the org-admin alternative) |
| Token TTL / cache TTL | 1h fixed (GitHub) / 50 min Redis (`INSTALLATION_TOKEN_CACHE_TTL_SEC`) | Unchanged; bounds the exposure window after a binding is removed |
| Max repos per token | 500 (GitHub API limit, noted at `langyGithubAppToken.ts:86`) | Upper bound on a project's mintable union; far above any realistic binding count |

## Invariants

| Invariant | Meaning | How satisfied |
|---|---|---|
| No silent widening for bound projects | A project with ≥1 binding never mints outside its bound set | Explicit-repo-not-in-set → deny; unresolvable repos excluded from the union; violated single-installation invariant → deny. Never a fallthrough to installation-wide |
| Rollout never widens | Phase 1 changes no unbound project's behavior and only narrows bound ones | Zero-bindings branch is byte-for-byte today's mint path until Phase 2 removes it |
| Binding ⊆ installation grant | A binding never mints access to a repo the installation wasn't authorized for | Write-time check against the grant; mint-time single-listing re-match excludes drifted repos; `onDelete: Cascade` kills bindings when the installation dies |
| Single-installation-per-project | A project's bound repos never span two GitHub installations | Atomic claim via unique index (`insertOrGetExisting` pattern), not check-then-write; mint fails closed if violated |
| Tenancy | A binding always resolves within one organization | `organizationId` anchor on the parent + `SCOPED_MODELS` entries for both tables; partition test enforces registration |

## Assumptions

| Assumption | What breaks if false |
|---|---|
| Every caller of `getOrProvision`/`mintTurnToken` gates on project-level session/permission before calling | The project boundary stops being the repo-access boundary — verified true today for the single caller (`langy-turn-base-dependencies.ts`) |
| A GitHub full repo name (`owner/repo`) is unique within a single installation | Repo-id resolution could pick the wrong repo — pre-existing risk in `resolveRepositoryId`, not introduced here |
| Projects binding repos number well under 500 per project | The union exceeds GitHub's per-token repo cap and the mint fails; no realistic customer is near this |

## Gates

| Path | Reversible? | Blast radius | Required gate |
|---|---|---|---|
| New tables + migration | Yes (additive) | Low | none |
| Tenancy registration for both tables | Yes | Medium | Partition tests in `dbOrganizationIdProtection.unit.test.ts` / multi-tenancy suite fail CI if missing — automated, already exists |
| `mintTurnToken` signature change + bound-project fail-closed | Yes (code) | High (security: wrong scope = over/under-grant) | Automated tests: explicit-repo-not-in-set denial; union mint with no explicit repo; drifted-repo exclusion via single-listing re-match; violated single-installation invariant → null; zero-bindings project keeps today's behavior (Phase 1) |
| Phase 2 removal of the zero-bindings fallback | Yes (revert) | High (turns off GitHub for still-unbound projects) | Own PR citing this ADR; requires picker UI shipped + binding window elapsed; human review |
| Binding-write path (permission, single-installation claim, grant check) | Yes | Medium | Automated tests: permission-denied for non-manager; concurrent-bind race yields one installation; out-of-grant repo rejected |

## Schema

```prisma
enum LangyGithubRepoBindingScopeType {
  PROJECT
}

model LangyGithubRepoBinding {
  id                 String                  @id @default(nanoid())
  organizationId     String
  organization       Organization            @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  installationId     String
  installation       LangyGithubInstallation @relation(fields: [installationId], references: [installationId], onDelete: Cascade)
  /// "owner/repo", validated against the installation's grant at write-time.
  repositoryFullName String
  createdAt          DateTime                @default(now())
  updatedAt          DateTime                @default(now()) @updatedAt
  scopes             LangyGithubRepoBindingScope[]

  // One binding resource per (installation, repo) — N projects sharing a
  // repo reuse this same row via N scope rows, not N duplicate resources.
  @@unique([installationId, repositoryFullName])
  @@index([organizationId])
}

model LangyGithubRepoBindingScope {
  id            String                          @id @default(nanoid())
  repoBindingId String
  repoBinding   LangyGithubRepoBinding          @relation(fields: [repoBindingId], references: [id], onDelete: Cascade)
  scopeType     LangyGithubRepoBindingScopeType
  scopeId       String
  createdAt     DateTime                        @default(now())

  @@unique([repoBindingId, scopeType, scopeId])
  @@index([scopeType, scopeId])
  @@index([repoBindingId])
}
```

Plus (not schema, but part of this decision's contract): `SCOPED_MODELS` entries for both models in `dbMultiTenancyProtection.ts` and `LangyGithubRepoBinding` in `ORG_TENANCY_EXEMPT` in `dbOrganizationIdProtection.ts`, mirroring `ModelProvider`/`ModelProviderScope`.

## Rejected alternatives

- **Inline `Project.repositoryFullName` column (PR #6080's approach).** Can't express N:1 or 1:N cardinality; unset-value fallback silently widens to full-installation scope. Replaced outright.
- **ORG/TEAM scope levels in the enum.** An org-level row would silently widen every project's resolved set the moment it's created. Addable later by migration if a real need appears.
- **Single-scope-per-row shape (mirroring `GatewayBudget`).** Wrong cardinality per `scoped-resources.md` — a repo binding is "one resource visible at many scopes," the documented junction case.
- **Multi-installation-per-project (array of tokens).** No known real requirement; changes the `LangyCredentials.githubToken` contract plus worker/credential-helper code. Revisit only on a real customer need.
- **Auto-backfill of installation repos into bindings at rollout.** Achieves day-one fail-closed but re-creates the #790 over-scope as permanent explicit config. The two-phase rollout gets the same "no customer breaks" property without the garbage rows.
- **Hard fail-closed on day one.** Breaks every existing customer's GitHub integration until a picker UI that doesn't exist yet lets them bind. Not viable.
- **Org-admin-only binding writes** (red-team recommendation). Rejected by decision owner in favor of `project:manage` convention-consistency; the self-grant consequence is accepted and documented below.
- **Single-bound-repo-or-deny mint** (red-team recommendation). Rejected: breaks multi-repo projects entirely until a per-turn repo selector exists; the union is bounded by explicit admin configuration, and JIT narrowing via `repoScopeKey` remains the path below it.

## Consequences

**Positive:** matches real production topology (1:1, N:1, multi-repo-per-project) with no further schema changes; fail-closed by construction for every configured project; rollout cannot regress any customer; reuses an established, CI-guarded pattern (5th junction instance) instead of a bespoke shape.

**Negative:**
- **Binding self-grant (accepted):** any `project:manage` holder can bind any repo the org's installation reaches and obtain `contents:write`/`pull_requests:write` on it through their project. The boundary is the org's installation grant plus project-manager trust, not per-repo ACLs. Revisit if a customer needs team-level repo isolation *within* one org.
- **Revocation lag (bounded):** removing a binding stops future mints immediately (the cache key changes with the repo set) but cannot revoke already-issued tokens — a worker can hold `contents:write` for up to the token's remaining ~1h lifetime. Same window exists today for installation-wide tokens; strictly smaller blast radius now.
- **Reinstall loses bindings:** uninstalling the GitHub App cascades all bindings; a reinstall (new `installationId`) requires re-binding every project. Correct per the grant invariant, but an admin-visible cost worth a warning in the uninstall UX.
- Mint adds one DB round-trip (bound-set lookup) and one repo-list resolution (cached DB list for `"selected"`, one live GitHub listing for `"all"`) per uncached mint.

**Neutral:** no UI is designed here — Phase 1 of this ADR's scope is data model + mint semantics; the picker is the named dependency of rollout Phase 2.

## Open questions

- Repo-picker UI/UX for admins attaching repos to a project — deferred, not blocking; it is however the gate for rollout Phase 2. Should read `dev/docs/best_practices/scope-selector-and-badges.md`; `ScopeChipPicker` remains the standard primitive.
- "Group on read" endpoint (per `scoped-resources.md`) so the settings UI shows "this repo → these N projects" as one row — deferred to the picker pass.
- Per-turn repo chip (turn says which bound repo it wants, narrowing below the union) — the `repoScopeKey` seam is ready for it; deferred.
- Whether the uninstall webhook path should notify org admins that project bindings were dropped — deferred.

## Revisions

- v1 (2026-07-30) — Sergio Esteban: initial decision. Locked junction-table shape (per `scoped-resources.md` cardinality rule), PROJECT-only scope levels (re-asked once via a worked example after the first answer showed confusion), union-of-bound-repos mint on no explicit repo, write-time + mint-time grant validation, and single-installation-per-project (re-asked once via a plain-language example). Supersedes the unmerged PR #6080 approach (`Project.repositoryFullName`) — nothing formally superseded, just abandoned.
- v2 (2026-07-31) — Sergio Esteban, after mandatory red-team (blast radius: security). Eight findings, all verified against code. Three reopened locked choices and were re-asked: **(a) rollout** — day-one fail-closed would disable GitHub for all existing customers (sole caller passes no repo, zero bindings everywhere, no picker UI); locked the two-phase rollout in Decision §6. **(b) binding permission** — red-team argued `project:manage` is a self-grant and recommended org-admin-only; decision owner overruled, keeping `project:manage`; dissent recorded, consequence documented. **(c) union mint** — red-team argued the union re-widens against #790's spirit; decision owner re-confirmed the union; dissent recorded. Five findings folded without reopening forks: single-listing mint-time validation (kills per-repo live listings when `repositorySelection="all"`), atomic-claim race fix + fail-closed on violated single-installation invariant, cascade-on-uninstall made an explicit decision with its cost documented, tenancy section corrected to the actual `ORG_TENANCY_EXEMPT`+`SCOPED_MODELS` precedent (v1 mis-stated the convention), and the token-cache/revocation window documented accurately (cache key changes with the set; only already-issued tokens linger, ≤1h).
