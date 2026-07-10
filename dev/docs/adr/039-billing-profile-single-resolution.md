# ADR-039: Billing profile is derived in one resolver — plan precedence, capabilities, and billing mechanics stop being stored or re-branched

Date: 2026-07-09
Status: Accepted (locked 2026-07-10)

> One-line: the **composite plan provider** becomes the single derivation point for **plan precedence** (ENTERPRISE license > active subscription > other license > free), **capabilities**, and **billing mechanics** (`meterUnit`, `memberPolicy`), so that stored duplicates like `Organization.pricingModel` are demoted to **self-healed cache** and every enforcement block carries a typed **resolution**.

## Context

A paying Growth customer was hard-blocked at "Team Members: 6/6" and ops was paged. Root cause: the org carried `pricingModel = TIERED` while holding an active `GROWTH_SEAT_*` subscription — `migrateToSeatEvent` was skipped by webhook ordering (`customer.subscription.updated` activated the sub before `invoice.payment_succeeded`, whose `previousStatus !== ACTIVE` gate then never fired; sibling of hazard C3 in the Stripe assessment). The red-team pass found the same drift had a second, worse effect: `getOrganizationForBilling` filters `WHERE pricingModel = SEAT_EVENT` (`organization.prisma.repository.ts:207`), so drifted orgs were also **excluded from the usage-metering population**.

Every surface that asked "how does this org pay?" read a different signal:

- `Organization.pricingModel` — stored column, schema default `TIERED`, flipped only at signup, in `migrateToSeatEvent`, or by hand in backoffice. Read for money decisions (metering gate) and UX decisions.
- `Subscription.plan` — the actual ground truth (`GROWTH_SEAT_*` ⇒ seat-event), consulted via `isGrowthSeatEventPlan` at some sites only.
- `PlanInfo.planSource` — composite provider; a valid license silently beats an active paid subscription.
- `plan.type === "ENTERPRISE"` — string checks at ~12 sites (`assertEnterprisePlan`).

~40 branch sites across 7 server files and 9 frontend files re-derive answers from these raw signals. Additional hazards found during investigation:

- `clearTrialLicenseIfPresent` (`webhookService.ts:940`) deletes **any** license on subscription activation — no trial marker exists. An enterprise-licensed org buying any subscription loses its license; a missed webhook leaves a stale license shadowing the paid subscription forever.
- `getSeatSyncService` / `syncSeatsToStripe` is dead code (zero callers) — the intended auto seat-sync never ran.
- `PLAN_LIMITS` (ee/billing) and `planTemplates` (ee/licensing) define the "same" plans independently (assessment hazard H11).
- Member counts include PENDING/WAITING_APPROVAL invites, so stale invites silently consume seats.

Forcing function: the incident recurs until derivation is centralized. Blast radius: money (seat billing, meter unit) and access (enterprise features, member adds) — full rigor applies.

Hard constraints (locked):
1. **License schema is append-only** — `verifySignature` re-serializes the parsed payload; removing/renaming fields breaks all issued licenses. New fields only. (The dead `evaluationsCredit` field in `types.ts:14` exists for exactly this reason and must survive constants unification.)
2. **No new service layer** — the consolidation lives in the existing composite plan provider (`src/server/app-layer/subscription/composite-plan-provider.ts`).
3. **OSS/self-hosted unaffected** — non-SaaS builds keep license-only resolution; no Stripe imports leak into OSS paths.
4. **No Stripe migration** — existing subscriptions/prices/items unchanged; only our interpretation layer changes.

Prior art: `specs/licensing/dual-pricing-model.feature` (PricingModel = HOW, PlanTypes = WHAT — revised by this ADR), `specs/licensing/enforcement-members.feature`, ADR-019 (layering), Obsidian `EPIC/Q2/stripe/assessment.md` §11 (C1–C3, H8, H11).

## Decision

1. **Plan precedence is a rank, computed only in the composite plan provider.**
   `ENTERPRISE license > active subscription > non-ENTERPRISE license > free.`
   "Active subscription" means DB `Subscription.status = 'ACTIVE'` — exactly today's `planProvider` predicate; this ADR does not change dunning/grace semantics (`FAILED`/`PENDING` fall through the rank as they do today — see Open questions for grace handling).
   WHY: an active subscription must beat a stale GROWTH/PRO license (the seat-flow dead-end class), while a sales-issued ENTERPRISE license must survive a leftover self-serve subscription (access > billing leak). Rejects: license-always-wins (perpetuates the dead-end), subscription-always-wins (kills enterprise SaaS deals mid-contract), highest-entitlement-wins (non-deterministic to reason about).

2. **Billing mechanics are derived from the winning source, never from stored state — and the metering gate moves with them.**
   The resolver computes `billing: { meterUnit, memberPolicy, showUsageLimits, isLegacyTiered }` on `PlanInfo`. Seat-event behavior is `activeSubscription.plan ∈ GROWTH_SEAT_PLAN_TYPES` — the `pricingModel` column is **not consulted for any decision**. This explicitly includes the Stripe usage-reporting pipeline: `getOrganizationForBilling` (`organization.prisma.repository.ts:207`) and `resolveMeterDecision` (`usage.service.ts:305`) migrate off the column onto the resolver **in step 1 of the rollout**, before any backfill (see Rollout). WHY: any stored duplicate of derivable truth drifts; deriving makes the incident class impossible by construction — and the metering gate is the money path that proves the column was never "just display".

3. **`Organization.pricingModel` becomes a self-healed display cache.**
   After the metering gate has moved (Decision 2), no decision reads the column. The resolver heals drift (plan-says-seat-event, column-says-TIERED) with a **write-once-guarded** fire-and-forget update: fire only if column ≠ target and no heal for this org fired within a TTL (multi-pod and read-replica-lag safe); heals also invalidate the meter decision cache for the org. A one-time backfill script fixes already-drifted orgs. The column stays for backoffice display and analytics. Rejects: dropping the column (breaks backoffice/analytics for no behavioral gain), keeping it authoritative with fixed migrations (drift remains reachable via backoffice edits and missed webhooks), naive fire-on-every-read (write amplification against replica lag).

4. **`memberPolicy` maps one-to-one from the winning source.**
   - active seat-event subscription → `purchase_seat` (proration modal, existing `addTeamMemberOrEvents` flow)
   - ENTERPRISE license → `hard_cap` (contact-us; seats live in the signed payload, deals are sales-owned)
   - non-ENTERPRISE license on **SaaS** → `upgrade` (subscription page; a purchased subscription outranks the license per Decision 1, preserving today's self-serve escape)
   - any license on **self-hosted** → `hard_cap` (no Stripe; expansion requires a new license)
   - legacy tiered paid subscription → `upgrade` (existing tiered→seat migration flow with credit)
   - free → `upgrade`
   Rejects: `hard_cap` for all licenses (downgrades self-serve-capable SaaS customers to contact-us — a new blocking scenario; caught in v3 review), routing licenses to Stripe seat purchase directly (contradicts the signed payload), `upgrade` on self-hosted (no Stripe — dead-end button), auto-regenerating licenses (separate ADR-sized feature — see Open questions).

5. **Every member-limit denial carries a typed `resolution`.**
   `checkLimit` results and `LimitExceededError` gain `resolution: "purchase_seat" | "upgrade" | "hard_cap"`, propagated through all five tRPC block paths (admin invite, non-admin invite request, approve request, lite→full role change, stale FE pre-check → server throw). The FE has one handler: `purchase_seat` → proration modal, `upgrade` → plans page, `hard_cap` → contact-us. On the **public API path** (`resource-limit.ts` middleware → 403 JSON to SDK/REST consumers) `resolution` is advisory metadata in the error body, not a rendered flow — documented as the sixth path. Rejects: server-side auto-purchase (charges money without an explicit confirmation click), fixing only the invite path (incident recurs via the other four).

6. **Capabilities replace plan-type string checks.**
   The resolver computes `capabilities: { rbac, scim, sso, groups, customRoles, audit }` (exact set finalized at implementation from the current `assertEnterprisePlan` call sites); `assertEnterprisePlan` becomes `assertCapability`. WHY: same scattered-branching disease; done once while consumers are already being touched.

7. **Plan definitions unify into one constants module.**
   A single shared module feeds both SaaS `PLAN_LIMITS` and license-generation `planTemplates` (kills hazard H11 drift). Safe for issued licenses — red-team confirmed: `verifySignature` re-serializes the payload that was signed at generation time (`validation.ts:47`); templates matter only at generation. The unified module preserves generation-side legacy fields (`evaluationsCredit`) for payload-schema stability.

8. **`isTrial` is added to new license payloads; webhooks clear only trials.**
   `clearTrialLicenseIfPresent` checks the flag; a non-trial license coexisting with an activating subscription raises an ops alert instead of silent deletion. Existing licenses without the flag are treated as **non-trial** (never auto-deleted — deleting a paid license is the worse failure). Pre-flag trial licenses in the wild are reconciled by a one-time review of stored licenses (internal cutover runbook) — re-issue with `isTrial` or revoke. Rejects: keeping the unconditional wipe (destroys enterprise licenses).

9. **Ops alerts split by resolution.**
   `purchase_seat` shown → info-level breadcrumb (self-serve friction funnel, no page). `hard_cap` / `upgrade` denial → real ops alert. Rejects: single undifferentiated alert (the ambiguity that triggered this investigation), alerting only on hard blocks (loses seat-purchase friction data).

10. **The five member-block paths and the seat flow consume only derived fields.**
    `useInviteActions`' three-condition gate (`activePlanSource === "subscription" && pricingModel === "SEAT_EVENT" && api.subscription`) collapses to `limitInfo.resolution === "purchase_seat"`. All 9 FE sites reading `organization.pricingModel` switch to `useActivePlan().billing.*`. `seatSyncService` dead code is deleted (self-heal in Decision 3 replaces its intent). Server sites (`EESubscriptionService.updateSubscriptionItems`, `previewProration`, `usage-meter-policy`, `usage.service`) read the resolver's output.

11. **Orphaned paying subscription under an ENTERPRISE license: let it run, alert only.**
    When the rank resolves to an ENTERPRISE license while an active Stripe subscription exists, the subscription keeps billing (seats and, where applicable, events) and an ops alert fires on detection. No code cancels or mutates the subscription; no runbook obligation is created. WHY (user decision): code auto-cancelling paid subscriptions on a derived signal is exactly the C1–C3 hazard class, and the case is rare; the accepted cost is a known billing leak until a human acts on the alert. Rejects: auto-cancel with proration (money-mutating code on a derived signal), alert + mandatory runbook (process weight disproportionate to frequency).

12. **The precedence flip ships behind a feature flag; the rest ships unflagged.**
    A flag gates only the license-vs-subscription precedence change (Decision 1) — the single behavior change for existing orgs — giving a kill-switch without redeploy. Derivation, self-heal, `resolution`, capabilities, and alert-split ship unflagged: they are strictly corrective. Rejects: flagging the whole resolver (keeps ~40 dual branches alive — the disease itself), no flag (reverting a money-path change requires a redeploy while a paying org is mis-resolved).

13. **Pending-invite seat consumption: surface, don't change.**
    PENDING/WAITING_APPROVAL invites keep reserving seats (prevents overselling: 6 seats + 6 pending invites must not admit 12 people). The 6/6 UI and every block modal itemize the count — "4 members + 2 pending invites" — with revoke affordances. No billing-semantics change. Rejects: not counting pending invites (oversell risk), leaving the count opaque (the "blocked at 6/6 while seeing 4 members" confusion stays).

## Rollout (ordered — sequencing is load-bearing)

1. **Move the metering gate**: `getOrganizationForBilling` + `resolveMeterDecision` read the resolver, not the column. Ship + verify metering population is unchanged for non-drifted orgs.
2. **Resolver ships** with derivation, capabilities, `resolution`, self-heal (write-once guard), alert split. Precedence flip dark behind the flag.
3. **Checkpoint seeding** (before any data change): each org whose metering turns on mid-cycle gets its `lastReportedTotal` checkpoint seeded to its current month-to-date total, so the first `reportUsageForMonth` run reports only post-cutover events — the checkpoint otherwise defaults to 0 and would report the entire month-to-date (`reportUsageForMonth.command.ts:202,265`). The operational cutover procedure (review steps, affected-population handling, license reconciliation) lives in the internal ops runbook, not in this ADR.
4. **Backfill** `pricingModel` (now display-only, per step 1 — the update no longer changes billing behavior by itself; metering for drifted orgs starts at step 1's deploy).
5. **Flip the precedence flag** after the license reconciliation (internal runbook) confirms no org resolves unexpectedly.
6. Consumer migration (~40 sites) and `seatSyncService` deletion ride steps 2–5 in the same PR series.

WHY this order: backfilling the column before step 1 would activate the *old* metering gate on the drifted cohort as a side effect of a "display" update — otherwise the first metering run reports retroactively (Invariant I8 violation).

## Constants

| Name | Value | Purpose |
|---|---|---|
| `PLAN_RANK` | `ENTERPRISE_LICENSE(3) > ACTIVE_SUBSCRIPTION(2) > OTHER_LICENSE(1) > FREE(0)` | Deterministic winner when sources coexist |
| Active-subscription predicate | `Subscription.status = 'ACTIVE'` (DB) | Today's semantics preserved; grace/dunning unchanged |
| `MemberPolicy` | `"purchase_seat" \| "upgrade" \| "hard_cap"` | How an org expands members at cap |
| `MeterUnit` | `"events" \| "traces"` | Usage metering basis (seat-event → events) |
| `LimitResolution` | same values as `MemberPolicy` | Carried on `checkLimit` / `LimitExceededError` |
| `GROWTH_SEAT_PLAN_TYPES` | existing, `ee/billing/utils/growthSeatEvent.ts:39` | The plan strings that mean seat-event |
| License payload addition | `isTrial?: boolean` (absent = non-trial) | Only trials are auto-cleared on sub activation |
| Self-heal guard TTL | 24h per org (Redis-backed, reuse `TtlCache`) | Write-once heal; multi-pod / replica-lag safe |
| Precedence feature flag | `release_billing_precedence_rank` | Kill-switch for Decision 1 only |

## Invariants

| Invariant | Meaning | Satisfied by / test anchor |
|---|---|---|
| I1 | An org with an active `GROWTH_SEAT_*` subscription always gets seat-event behavior, regardless of `pricingModel` | Derivation in resolver; test: TIERED column + seat sub → `memberPolicy === "purchase_seat"` **and** org is metered |
| I2 | An ENTERPRISE license is never silently deleted or outranked by a subscription | Rank + `isTrial` guard; test: enterprise license + activating sub → license intact, plan = enterprise, ops alert fired |
| I3 | No member-limit denial is emitted without a `resolution` (rendered on the 5 tRPC paths; advisory JSON on the public API path) | Typed error everywhere; integration test per path incl. `resource-limit.ts` 403 body |
| I4 | After rollout step 1, no billing or access decision reads `pricingModel`; column drift is display-only and converges | Metering gate moved first; lazy heal test: drifted org → first `getActivePlan` heals column once (guard blocks repeat) and invalidates meter cache |
| I5 | OSS builds resolve identically to today | License-only provider path untouched; existing OSS test suite |
| I6 | A seat purchase confirmation is always explicit | No server-side auto-charge; FE modal is the only purchase trigger |
| I7 | SaaS and license generation read one plan-definition source | Shared constants module; compile-time: both import from it |
| I8 | Turning metering on for a drifted org never bills retroactively | Checkpoint seeding at cutover (rollout step 3a); test: seed org checkpoint to month-to-date N → first report bills only events beyond N |

## Schema

No Prisma migration. Changes:

```ts
// License payload (append-only — new optional field)
{ ..., isTrial?: boolean }  // absent ⇒ non-trial ⇒ never auto-cleared

// PlanInfo additions (computed, not stored)
billing: {
  meterUnit: "events" | "traces";
  memberPolicy: "purchase_seat" | "upgrade" | "hard_cap";
  showUsageLimits: boolean;
  isLegacyTiered: boolean;
};
capabilities: { rbac: boolean; scim: boolean; sso: boolean; /* finalized from call sites */ };
```

One-time backfill (rollout step 4 — only after the metering gate has moved; read-verify then run):

```sql
-- Orgs with an active seat-event subscription but a stale pricingModel
UPDATE "Organization" o SET "pricingModel" = 'SEAT_EVENT'
WHERE o."pricingModel" <> 'SEAT_EVENT'
  AND EXISTS (SELECT 1 FROM "Subscription" s
              WHERE s."organizationId" = o.id AND s.status = 'ACTIVE'
                AND s.plan LIKE 'GROWTH_SEAT_%');
```

## Rejected alternatives

- License-always-wins precedence — perpetuates the seat-flow dead-end (the incident).
- Subscription-always-wins — breaks enterprise SaaS deals provisioned as licenses.
- Highest-entitlement-wins — non-deterministic; billing and entitlement diverge.
- `pricingModel` stays authoritative with fixed migrations — stored-state drift remains reachable (backoffice, missed webhooks).
- Dropping the `pricingModel` column — breaks backoffice/analytics for no behavioral gain over cache.
- Server-side auto seat purchase — charges without explicit consent.
- Auto-cancelling the orphaned subscription under an ENTERPRISE license — money-mutating code on a derived signal (C1–C3 hazard class).
- Keeping drifted orgs permanently un-metered — revenue leak becomes policy; two org classes forever.
- Retroactive catch-up metering for drifted orgs — violates Invariant I8.
- Fixing only the invite path — four other paths keep the incident alive.
- Deferring capabilities / plan-constants unification — leaves the same disease in neighboring organs (user chose in-scope).
- New `BillingProfileService` — a second authority recreates the two-sources problem one layer up.
- Flagging the whole resolver — keeps ~40 dual branches alive during rollout.
- Not counting pending invites toward seats — oversell risk (6 seats admitting 12 people).
- Nightly reconciliation cron for the column — operational surface for display-only data.

## Consequences

**Positive:** the incident class is impossible by construction; enterprise licenses can't be destroyed by a webhook; the silent under-metering of drifted orgs is found and fixed; one place to read when debugging "why is this org billed/gated like this"; ops can distinguish self-serve friction from stuck customers; H11 drift killed.

**Negative:** ~40 call sites churn across an ordered PR series (mitigated: mechanical, each site becomes simpler); precedence change is a behavior change for GROWTH/PRO-licensed SaaS orgs that also hold an active subscription — they flip from license-limits to subscription-limits (reviewed at cutover per the internal runbook, kill-switch via flag); metering for previously-excluded organizations begins at cutover; the orphaned-sub-under-ENTERPRISE-license leak persists until a human acts on the alert (explicitly accepted, Decision 11); **while the precedence flag is off (rollout steps 2–5), license+subscription orgs keep license-wins resolution — their metering mismatch and seat-flow dead-end persist until the flag flips; step 2 fully fixes only the no-license drift class (the original incident)**; the resolver gains responsibility (mitigated: it was already the choke point for planSource).

**Neutral:** `dual-pricing-model.feature` needs revision (PricingModel demoted from "HOW billing works" to cache); backoffice keeps editing the column but edits no longer affect behavior (H8 remains for subscription-row edits — out of scope).

## Open questions

- Dunning/grace semantics: `FAILED`/`PENDING` subs fall out of the rank instantly (today's behavior — a transient payment failure drops entitlements). Owner: Sergio; candidate follow-up ADR on grace periods.
- License self-serve seat expansion (regenerate license with more seats) — deferred, owner: Sergio, separate ADR.
- Backoffice subscription edits bypassing invariants (assessment H8) — out of scope here; tracked in the Stripe assessment.
- Whether `resolution` should extend to non-member limit types (projects, workflows) — decide at implementation; the enum is designed to extend.
- Exact `capabilities` key set — finalized from the 12 `assertEnterprisePlan` call sites during implementation.
- Reconciliation of pre-flag licenses (rollout step 3b) — procedure in the internal ops runbook; owner: Sergio.

## Revisions

- v4 (2026-07-10): Redaction pass — operational/business cutover detail (affected-population review, customer communication, license reconciliation procedure) moved out of this public ADR into the internal ops runbook; engineering invariants unchanged.
- v1 (2026-07-09): Initial draft. Round 1 locked: full-consolidation scope, money+access blast radius, 4 hard constraints. Round 2 locked: precedence rank (after worked ACME example — user initially leaned subscription-always-wins), derive-from-plan authority with cache column, memberPolicy mapping, capabilities in scope. Round 3 locked: typed resolution on all 5 paths, lazy heal + backfill, plan-constants unification in scope (user overrode defer recommendation), alerts split by resolution.
- v3 (2026-07-10): Adversarial consistency review vs conversation locks (all 16 locks verified present). Finding 1 reopened the memberPolicy fork: `hard_cap` for all licenses was a self-serve regression — non-ENT-license SaaS orgs can buy a subscription that outranks their license; user locked SaaS→`upgrade` / self-hosted→`hard_cap` / ENTERPRISE→`hard_cap` (Decision 4). Finding 2: I8 had no mechanism — `reportUsageForMonth` checkpoint defaults to 0 and would bill the full month-to-date; fixed via checkpoint seeding at cutover (Rollout 3a, I8). Finding 3: flag-off window consequence stated explicitly (Consequences).
- v2 (2026-07-09): Red-team pass (devils-advocate) folded in. Blocker 1 — `pricingModel` was NOT cosmetic: it gates Stripe event metering (`getOrganizationForBilling`); drifted orgs were silently un-metered. Added ordered Rollout section (metering gate moves before backfill), I8 (no retroactive billing), user locked bill-forward cutover. Blocker 2 — orphaned paying sub under an ENTERPRISE license: user locked let-it-run + alert-only (Decision 11). Also from red-team: active-subscription predicate pinned to `status='ACTIVE'` (Decision 1), pre-flag trial-license audit (Decision 8 + rollout 3b), public API documented as sixth advisory path (Decision 5, I3), self-heal write-once guard + meter-cache invalidation (Decision 3), plan-constants unification confirmed safe (Decision 7). New user locks: precedence flip behind feature flag (Decision 12), pending-invite seats surfaced not changed (Decision 13).
