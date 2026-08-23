# Identity Platform — Delivery Plan

The final spec: how the thirteen deliverables (`D01`–`D13`, see `../identity-platform-redesign.md` for the epic) sequence, gate, and roll back. Each deliverable is a sealed goal: independently shippable, flag-gated, measurable exit, stated rollback.

# Precondition — authz program landed

**Landed (2026-08-23 check against `main`).** The unified authorization engine is ADR-092 (engine, registry, fork) as reshaped by **ADR-110** (`dev/docs/adr/110-grant-aggregates-are-grants.md`; #7358, #7404): a grant is its own aggregate, there is one migration per organization, and finishing it IS the switch — no cutover step, no cutover table, no cached cutover gate, no cohorts. The engine gate (`server/app-layer/authz/engine-gate.ts`) reads the migration's `finalized` status and nothing else. Ready-to-start checklist, as it stands on `main`:

- [x] `packages/authz/src/registry.ts` is the permission registry (org-scope entries exist; registry-derived `Permission` type exported).
- [x] `GrantsService.attach` / `.offboard` (`packages/authz-server/src/grants.service.ts`) emit ledger commands with actor context; offboard takes a principal filter and carries the empty-proof postcondition (`offboard.ts`).
- [x] `.permission()` on tRPC procedures (`server/app-layer/authz/trpc-middleware.ts`, resolved through `getApp().permissions`); `useCan` / `RequireCan` for UI.
- [ ] Edge middleware: any credential → `Principal {actor, subject}` with session claims — the vocabulary exists (`packages/authz/src/vocabulary.ts`), the impersonation-aware principal is D06's to finish.
- [x] The `Role` projection supports org-scope permission keys (for the IT-admin role).
- [x] Every membership write in identity code goes through `grants.*`, every check through `.permission()` / `getApp().permissions` — identity code never calls `rbac.ts`/`TeamUser`.

D05 and D08 consume the checked items. **Any authz API change is a breaking change to this program** (risk register).

## What the authz program hands this program

- **The Redis-loss breaker is doctrine, not a primitive.** ADR-007's shared amendment names `authz_grants` and expects `identity` to join; there is **no breaker code** — no state machine, no probes, and *no in-memory processor, ever*. What D02 adds is identity joining the amendment with its own volume analysis, plus the two seam hardenings the doctrine implies (best-effort staging, fail-open secondary storage) — nothing resembling a breaker gets built. Note the asymmetry ADR-110 then stated for authz — *every write through the group queue; Redis down ⇒ authz writes down* — which identity deliberately does **not** adopt (ADR-101 §Revision 2026-08-23): sign-in is the one write path that must survive Redis loss, so the fold apply stays on the calling path.
- **The ADR-110 rollout shape** — new native head born clean, adoption by ids that are stable across retries, one migration that states facts and checks once, `finalized` as the only switch, held tenants with their outstanding facts named, rollback as a status change — is what Wave 1 transplants, re-tenanted to users. The earlier three-stage arc (witnessed migrations → write gate → parity-proved cutover) is gone from `main` and from this plan.
- **`@langwatch/system-migrations` (on `main`, #7079, #7337)** drives every in-place backfill: leased runner in the worker process with per-tenant claims, state machine `pending → migrated (held) → finalized → rolled_back`, parked failures, ops migrations dashboard + operator rollback included. Cloud pacing is per-(organization, migration) enrollment and nothing else. D01's identifier backfill and D04's grandfathering are riders; D09's per-customer progress record is a candidate (open question there).
- **SCIM converges on `grants.*`** (D08): when connections exist, the reconciler's actor is the connection — `actor: { type: "system", id: <connectionId> }` — which the ledger event shape accommodates with no schema change.
- **Offboarding is a service seam**: identity deprovision paths call `GrantsService` (revoke/offboard, empty-proof postcondition); no identity imports inside authz packages, no cross-pipeline event subscriptions.
- **Doctrine mirrored, never shared tables**: identity copies the ledger's dispatch discipline (waited CH append, idempotent applies, deterministic ids, caller-minted commandIds) and its projection-cursor pattern — but no table has two pipeline owners, and identity events may carry emails where the ledger's stay pseudonymized (epic R11).

# Sequencing

Critical path: **D01 → D02 → D03+D13 → D04 → D05 → D08 → D09 → D10**. D11 forks off after D01; D06/D07/D12 fork off after D03/D05; Wave 4 has no dates by design.

The chart shows the wave structure; the exact per-deliverable dependencies live in the **Needs** column of the tables below (drawing every edge made the graph unreadable).

```text
 WAVE 1                      WAVE 2                         WAVE 3                           WAVE 4
 foundations —               the new front door             self-service + factors           Auth0 dies —
 nothing a user can see      + the invite fix               (parallel tracks)                customer-paced

 D01 identifiers             D03 router  ═╗                 D05 self-serve SSO +             D09 per-customer
  └─► D02 auth-path          D13 screens ═╝ one flag         │  identity surfaces                migration
      breaker           ──►   └─► D04 SsoConnection    ──►   └─► D08 SCIM per          ──►    └─► D10 delete
                                  aggregate                      connection                       Auth0
                             D11 resilient invitations      D06 MFA  ·  D07 passkeys
                             (needs only D01)               D12 join requests + auto-join
                                                             ▲
                             authz precondition ═════════════╝  hard — gates D05 and D08
```

# What each wave actually delivers

## Wave 1 — foundations

Nothing a customer can see. Both deliverables exist to make Wave 2 safe.

| # | Needs | What ships | Impact when it lands |
|---|---|---|---|
| D01 | — | The identifier model: one user, many verified sign-in methods, a new pure event-truth Postgres `Identifier` projection (born clean; `Account` stays 100% row-truth protocol), full backfill via system-migrations with per-user write gating | No product change yet — but identity state becomes *visible data* for the first time, and every other deliverable builds on it |
| D02 | D01 | ADR-007's Redis-loss doctrine applied to the auth path: Redis down ⇒ sessions go PG-only, ceremonies complete on the calling path (append + apply), staging best-effort | A Redis outage stops locking every customer out of sign-in; de-risks the D03 cutover before it exists |

## Wave 2 — the new front door + the invite fix

The customer-visible core: a completely new unauthenticated experience, and the end of the invitation dead ends.

| # | Needs | What ships | Impact when it lands |
|---|---|---|---|
| D03 | D01, D02 | The identifier-first routing engine: email → route to the right IdP or method set, auto-link rules, shadow-compared cutover | One front door for every method at once — ends the one-method-per-deployment limit; account-linking dead ends stop being support tickets |
| D13 | D01; flips with D03 | The complete first-party sign-in & sign-up screens (Auth0 owned these visuals until now): sign-in, sign-up, method picker, password reset, email verification, every deny/guidance state | The first thing every user ever sees is ours; sign-up gains the join-your-team step **before** workspace creation, which is where orphaned organizations stop being minted |
| D04 | D03 | `SsoConnection` as a real aggregate with a guarded lifecycle; existing `ssoDomain` strings grandfathered in silently | Enterprise SSO becomes data with history instead of two hand-set strings; no customer notices, which is the point |
| D11 | D01 only | Resilient invitations: accept via any verified method, one-click resend, 14-day expiry, visible states | The loudest support pain (invited with email, has a Google account, can't get in) is fixed — before the router cutover makes noise |

## Wave 3 — self-service + factors

Parallel tracks; staff in any order capacity allows.

| # | Needs | What ships | Impact when it lands |
|---|---|---|---|
| D05 | D04 + authz checklist (hard) | Self-serve SSO onboarding (register → verify domain → activate) plus both identity surfaces: platform-ops lookup and the org-admin panel | Enterprise onboarding drops to one LangWatch action (an approval click); DB surgery as a support tool ends |
| D06 | D03 | TOTP MFA + backup codes, org-level `mfaRequired`, sessions that carry `amr` (one forced re-login) | Orgs can finally require MFA; impersonation and step-up become provable |
| D07 | D03 | Passkeys via WebAuthn, including no-email discoverable sign-in | The fastest sign-in method, and the phishing-resistant one |
| D08 | D05 + authz checklist (hard) | SCIM tokens scoped per connection; SCIM writes membership only through `grants.*` | Cross-org SCIM writes become impossible; deprovisioning gets a provable postcondition |
| D12 | D03/D13 + D05 | Join requests + domain auto-join: sign up with a work email → see your company's org → request (admin approves) or walk straight in where the org allows it | "I signed up and my company was invisible" is over; the join-before-create flow is what starves orphaned organizations |

## Wave 4 — Auth0 dies

| # | Needs | What ships | Impact when it lands |
|---|---|---|---|
| D09 | D05, D08 | The per-customer migration wizard with both-connections grace and the legacy callback shim (R9) | Each enterprise moves at its own pace with rollback built in; nobody reconfigures their IdP under pressure |
| D10 | D09 program exit: zero ACTIVE legacy connections | Deletion: provider config, password service, webhook, shim, secrets, QA login | Auth0 spend and code hit zero. This is the program's DONE signal — customer-paced, not a scheduled milestone |

# Sequencing rationale

- **D02 before D03** — the cutover milestone should not also be the milestone that discovers Redis-loss takes down sign-in. Cost is touching dispatch before real load exists; acceptable.
- **D03 and D13 flip together** — one flag (`IDENTITY_ROUTER_V2`): the router is the logic, the screens are the experience, and shipping either alone would mean building throwaway UI or an invisible engine. Shadow mode exercises the router only; the screens appear at the enforce flip.
- **D03 is the highest-risk deliverable** — every human's front door. It lands only after D01's replay parity and D02's Redis-kill test are green.
- **D11 was pulled out of the old combined deliverable into Wave 2**: identifier-aware acceptance and one-click resend need only D01's identifiers — they fix the loudest support pain and shouldn't wait for the router. Resend UI lands in the existing members/invitations area; the org-admin surface absorbs it at D05.
- **D06/D07/D08/D12 are mutually independent** after D03/D05. Suggested order: D06 → D07 → D08; D12 needs D13's interstitial hook (rides D03's flag) and D05's org-admin surface.
- **D09 is customer-paced, per tenant, slow by design** — no fleet deadline. **D10 is a program exit criterion, not a schedulable milestone**: it starts when the last legacy connection tears down; Auth0 spend and the agents-box login survive until then, and that's fine.

# Deliverable gates

| # | Flag(s) | Exit gate | Rollback | Risk |
|---|---|---|---|---|
| D01 | — (write gate is data, ships closed) | Replay rebuilds `Identifier` from CH and matches live table; backfill parity self-proving per user; adapter routing-table coverage: every better-auth model+operation explicitly routed, unrouted writes fail | Un-enroll / roll back migration state — adapter stops emitting, protocol writes untouched; table additive, nothing reads it until D03 | Low |
| D02 | `AUTH_REDIS_FAIL_OPEN` | Dev-compose Redis-kill: sign-in + attach + detach + session refresh pass; staging-drop and fail-open metrics emitted | Flag off = today's behavior | Medium (touches dispatch) |
| D03 | `IDENTITY_ROUTER_V2` (shadow → enforce) | Zero unexplained shadow mismatches over bake; sign-in success ≥ baseline | Flag off | **Highest** |
| D04 | `SSOCONN_ROUTING` (shadow → enforce) | Routing parity silent vs `ssoDomain` strings; string writes stopped | Flag off, strings still dual-written | Medium |
| D05 | `SELF_SERVE_SSO` (per-org) | New enterprise customer onboards with exactly one LangWatch action (approval click); ops surface resolves a real support case | Per-org flag off | Medium |
| D06 | `MFA_ENROLLMENT_OPEN` + deploy-time session revoke | Enroll → challenge → backup-code → disable round-trips; org policy enforced; lockout verified | Flag off; session kill is irreversible (comms!) | **One-way door** |
| D07 | `PASSKEYS_ENABLED` | Register / sign-in / no-email sign-in / delete round-trips, platform + cross-platform authenticators | Flag off | Low |
| D08 | `SCIM_V2_GRANTS` | Push/group/deactivate round-trip; token scoping enforced; offboard postcondition asserted in integration test | Legacy write path behind flag | Medium |
| D09 | per-customer | Per customer: all active users linked, quiet grace, shim hits at zero, teardown event. Program: zero ACTIVE legacy connections | Both-connections-active grace IS the rollback | Customer-facing |
| D10 (program exit criterion — customer-paced) | — | Repository-wide `grep -ri auth0` → changelog only; secrets blob + deployment config verified Auth0-free; deploy pipeline green | Tagged restore point + secret escrow, retired only after the observation window (see D10) | Low |
| D11 | invite changes additive | Round-trips: invite → wrong-method → accepted; expiry → resend → accepted; Slack invite cases replay green | Additive; old flow flag-restorable during bake | Low |
| D12 | `JOIN_REQUESTS` | request → approve → member round-trip; domain auto-join round-trip (org opt-in, never public email domains); reminder/expiry wakes verified; matching/privacy specs green; orphaned-org creation rate visibly down | `JOIN_REQUESTS` off | Low |
| D13 | `IDENTITY_ROUTER_V2` (with D03) | Every unauthenticated journey round-trips in the new UI: sign-in per method, sign-up per method, reset, verification, deny/guidance states; zero Auth0-hosted pages or assets; sign-up completion ≥ baseline | Flag off — legacy screens intact until bake end | Medium (rides the D03 flip) |

# Wave 1 — PR breakdown

The program starts here. Same shape as the authz program's plan (`dev/docs/plans/adr-092-authz-delivery-plan.md`): few PRs, gates and data protect the rollout, not PR boundaries — every PR ships gated closed and is production-safe on its own. D01 is two PRs because live path and history are separately provable: PR 1 lands everything dark (the write gate answers false for every user until a backfill exists), PR 2 brings the runner plumbing that opens it per user.

```text
 PR 1  D01a — the live path                PR 2  D01b — history + rollout
 pipeline skeleton + no-op round-trip      user-rooted TenantSource for the runner
 additive migration: NEW Identifier        backfill rider (adoption events,
 table (PG) + User.userHashKey             deterministic ids, backdated occurredAt)
 identity adapter + routing table          org-driven enrollment pacing +
 fold apply on the calling path       ──►  (no everyone-else cohort: ADR-110)
 per-user write gate (ships CLOSED —       backfill parity self-proving per user
 no migration rows exist yet)              (the D01 exit gate) — latch opens the
 verification ceremony guards              adapter's write gate user by user
 replay discovery from day one
                                           PR 3  D02 — auth-path Redis-loss
                                           identity joins ADR-007's Redis-loss
                                           amendment (volume analysis in ADR-007)
                                           sessions PG-only (fail-open seam) ·
                                           best-effort staging hardened ·
                                           flag AUTH_REDIS_FAIL_OPEN · Redis-kill test
```

- **PR 1 gate:** no-op command round-trip green; adapter routing-table coverage green (every better-auth model+operation explicitly routed, an unrouted write fails at startup); replay-parity green (rebuild `Identifier` from CH, diff vs live — trivially empty until users latch, structurally proven by test); write gate demonstrably closed by default. Rollback: revert — the table is additive, nothing reads it, no user is latched.
- **PR 2 gate:** the D01 exit gate — backfill parity: the fold-built `Identifier` rows match what live `Account`/`User` rows imply, per user (the migration states its facts and checks once; disagreement holds the user at `migrated` with the outstanding identifiers named on the ops migrations page, and the gate stays closed for a held user — `finalized` is the only switch, ADR-110). Rollback: withdraw the organization's enrollment / move the user's status to `rolled_back` — the write gate closes again within its TTL, protocol writes never depended on it.
- **PR 3 gate:** the D02 exit gate — dev-compose Redis-kill: sign-in + attach + detach + session refresh pass; staging-drop and fail-open metrics emitted. Rollback: `AUTH_REDIS_FAIL_OPEN` off = today's behavior. The ledger PR 1 (#7143) dependency is satisfied — it merged 2026-08-18, as doctrine (the ADR-007 amendment), not as a primitive.

D11 (invitations) forks off after PR 2 for a second engineer; D03/D13 start only when the Wave 1 gates are green.

> **Landed 2026-08-20:** PR 1, PR 2 and PR 3 shipped together in a single PR alongside the program docs (Alex's call). The per-PR gates above still hold slice by slice and remain the review map; the one outstanding exit-gate step is the dev-compose Redis-kill run, which needs a running stack.
>
> **Re-based 2026-08-23 on ADR-110:** the authz cutover gate the write gate was transplanted from no longer exists on `main`; the gate now opens on `finalized` only through the shared per-subject cache the engine gate uses; the everyone-else cohort and the org-paced enrollment expansion's synthetic ids are deleted (enrollment is a switch); the backfill restates every pass and detaches identifiers whose account row is gone. ADR-101 carries the revision note.

# ADRs to write (before or with the gated deliverable)

Plain design docs, written before the code they cover:

1. **Identity platform + identifiers** (D01) — **written: [ADR-101](../adr/101-identity-pipeline-and-identifiers.md)** (revised 2026-08-20; re-based on ADR-110 2026-08-23). The identity adapter (R10) with its per-user write gate; the truth split — a new pure event-truth Postgres `Identifier` projection, `Account` stays 100% row-truth protocol — which leaves **ADR-022 and ADR-015 unamended** (the earlier column-truth carve-out and replay column scoping are deleted from the program); the ADR-110-shaped rollout re-tenanted to users (org enrollment expanding to members, per-user `finalized` latch, calling-path apply as the one recorded divergence). Carries the payload rule (the email rides in the event where the fact is about one; HMAC-keyed hashes; secrets never) and erasure-as-event-plus-log-wipe (R11).
2. **Auth-path resilience** (D02) — adds the `identity` pipeline to **ADR-007's shared Redis-loss amendment** (which names `authz_grants` and expects identity to join), with the identity-specific volume and failure-semantics analysis.
3. **Sign-in router, screens + SSO self-service** (D03/D13–D05) — identifier-first routing, auto-link rules, the first-party screen set; **explicitly amends ADR-027 (`027-license-gated-sso.md`; the number is collided)** (hook → per-method router policy; carries over the constants table and the route-table canary; answers the license-timing question, Open Q11).
4. **MFA + session shape** (D06) — `amr` semantics incl. the passkey/`phw` decision (Open Q4); the forced re-login.

Gherkin specs to write fresh (no existing coverage): join-request lifecycle including domain auto-join and the join-before-create sign-up path (D12/D13), the full sign-in & sign-up screen set with its deny/guidance states (D13), org-admin surface panels (D05), ops lookup actions (D05), MFA enrollment/step-up (D06), connection self-service lifecycle (D05). Use `/write-spec` per deliverable.

# Spec-amendment table (existing corpus)

| Existing spec | Action | Deliverable |
|---|---|---|
| `specs/auth/phase-1-better-auth-config.feature` | Retire `NEXTAUTH_PROVIDER` matrix (:19-45), `ssoProvider` matching (:51-73), `pendingSsoSetup` (:112-117); keep better-auth/bcrypt anchors | D03 |
| 〃 `:119-137` (legacy `Session.impersonating`) | Retire; replace with `{actor, subject}` scenarios | D06 |
| `specs/auth/auth-signin-flows.feature` | Port credentials/Google flows to the router + the new screens; Auth0 flow retired at D10 (legacy callback kept working by the shim, R9, until then) | D03/D13, D09/D10 |
| `specs/auth/sso-oidc-providers.feature` | Port Cognito/OneLogin from `NEXTAUTH_PROVIDER` mounting (:24, :32) to the self-hosted default method set; discovery-document configuration survives | D03 |
| `specs/auth/sign-in-failure-messages.feature` | Anchor — failure copy (wrong password, rate-limit wait, origin mismatch) survives on the new screens | D13 |
| `specs/auth/password-reset.feature` | Flip cloud/SSO-mode rejection per Open Q9; keep no-oracle + revoke-all anchors | D03 |
| `specs/auth/sso-wrong-provider-recovery.feature` | Port from `ssoDomain` strings to `SsoConnection`; most scenarios survive | D04 |
| `specs/auth/sso-orphan-user-linking.feature` | Generalize into the auto-link/admin-confirm rule; reconcile "unverified orphan" with R8 | D03 |
| `specs/auth/signup-does-not-strand-an-account.feature` | Anchor (keep); resolve enumeration tension (Open Q12) | D03 |
| `specs/settings/change-password-auth0.feature` | Retire Auth0 Management API scenarios; rewrite as identifier-model password change | D10 |
| `specs/members/update-pending-invitation.feature` | 48h → 14 days; states → PENDING/ACCEPTED/EXPIRED/REVOKED (WAITING_APPROVAL retired, epic Q13); add resend scenarios | D11 |
| `specs/licensing/enforcement-members.feature` (expired-invite counting only) | Align to new invite states | D11 |
| `specs/licensing/sso-license-gating.feature` | Amend mechanism (hook → router policy); settle restart semantics (Open Q11); behavioral invariants survive — including domain auto-join as licensed SSO (:10-11, :182), which D12's `domainJoin` honors | D03, D12 |
| `specs/features/scim-group-mapping.feature` | Amend deprovisioning to grants-offboard framing (20/24 scenarios `@unimplemented` — cheap now) | D08 |
| `specs/groups/groups-rest-api.feature` | Keep provenance anchors (SCIM-managed guards survive) | D08 |
| `specs/organizations/scim-tokens-rest-api.feature` | REST mint/revoke gains connection scoping (create names a connection); secret-shown-once and no-secrets-in-list anchors survive | D08 |
| `specs/ai-gateway/governance/sessions-and-devices.feature` | Session inventory gains `identifierId`/`amr`; `maxSessionDurationDays` × forced re-login interplay | D06 |
| `specs/auth/impersonation-banner.feature`, `specs/ops/dejaview-impersonation-access.feature`, `specs/features/backoffice-user-impersonation-reason.feature` | Anchors — survive; mechanism swaps underneath | D06 |
| `specs/features/user-deactivation.feature:134-143` | Stale "NextAuth signIn callback" wording sweep; behavior anchor survives | D03 |
| `specs/event-sourcing/pipeline-model.feature` | Doctrine anchor for D01 — no change | D01 |
| `specs/rbac/*`, `specs/api-keys/*`, `specs/members/member-role-team-restrictions.feature` | Owned by the authz program, not this one — listed for visibility | — |

# Flag inventory

`AUTH_REDIS_FAIL_OPEN` (D02) · `IDENTITY_ROUTER_V2` (D03 + D13 — router and screens flip together) · `SSOCONN_ROUTING` (D04) · `SELF_SERVE_SSO` per-org (D05) · `MFA_ENROLLMENT_OPEN` (D06) · `PASSKEYS_ENABLED` (D07) · `SCIM_V2_GRANTS` (D08) · invite changes additive (D11) · `JOIN_REQUESTS` (D12) · deploy-time session revoke (D06, one-way).

House discipline: dashboards before flags flip. Metrics pack per deliverable: routing decisions by outcome, link proposals auto vs confirmed, ceremony success rates, SCIM dead-letters, Redis-loss seam drops/fail-opens, join-request funnel (incl. auto-joins), invite resend/expiry rates, sign-up funnel + orphaned-organization creation rate, per-customer migration progress + shim hits, sign-in success vs baseline.

# Risk register

| Risk | Where | Mitigation |
|---|---|---|
| Cutover breaks sign-in fleet-wide | D03 | Shadow bake with zero-mismatch gate; flag off = instant revert; D02 already landed |
| New front door tanks sign-up conversion | D13 | Sign-up funnel dashboard live before the flip; completion ≥ baseline in the exit gate; flag off restores legacy screens |
| Domain auto-join admits the wrong person | D12 | Org opt-in only; verified email required; public email domains excluded outright; every auto-join is an audited event admins are notified of |
| Replay touches protocol secrets | D01 | Structurally impossible: `Account` is not a projection and never enters replay; `Identifier` carries no secrets and replays whole-row (ADR-101 §3); replay-parity test in exit gate |
| Calling-path applies overload web role during Redis outage | D02 | Identity volume is hundreds/day; seam timeouts bound latency; drop/fail-open metrics; ADR-007's amendment records the analysis |
| Session revoke-all strands users mid-work | D06 | Comms + precedent (better-auth cutover); schedule low-traffic window |
| Customer IdP apps pin legacy Auth0 callback URI | D09 | Resolved (R9): temporary shim with per-org usage metric through grace; removed at D10 |
| Auth0 retirement stalls on stragglers | D09/D10 | By design: per-tenant, no deadline; D10 is an exit criterion, not a milestone; nudge/escalation ladder in the wizard |
| Authz API drift while we build against it | D05/D08 | Precondition checklist is a contract; any authz API change is a breaking change to this program |
| Domain-approval queue becomes the new bottleneck | D05 | Staffing/SLA is Open Q2; measure queue latency from day one |

# Staffing notes

- D01–D03 are strictly sequential, same owner ideally (they share the pipeline + dispatch path).
- D13 pairs with D03: one engineer on the router, one on the screens, one flag between them.
- D06/D07 pair naturally (both touch session shape + better-auth plugins).
- D09 is engineering + CS per customer; the wizard and playbook are engineering's deliverable, execution is shared and deliberately slow.
- D02 and D11 (invitations) are the best parallelization candidates for a second engineer; D11 needs only D01 and can start immediately after it.
