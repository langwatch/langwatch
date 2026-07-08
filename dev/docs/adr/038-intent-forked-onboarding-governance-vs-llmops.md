# ADR-038: Onboarding forks on a first-class Organization intent — Agent Governance lands /me, LLMOps lands the project — and governance GA is a routing non-event for legacy orgs

**Date:** 2026-07-08

**Status:** Accepted (locked 2026-07-08)

> One-line: New signups pick **Track AI coding agents** or **Monitor & evaluate my LLM app** on **screen 2**; the choice is persisted as a **first-class `Organization.primaryIntent` enum** (editable in org settings) that **always decides the `/` landing** — `AGENT_GOVERNANCE` → `/me`, `LLM_OPS` → `/{project-slug}`, `NULL` (every pre-existing org) → today's resolver behavior unchanged; the governance track goes **straight to CLI setup**; governance goes **GA via flag rollout** with the CLI 403 kept as a flag-armed safety net; **no CLI changes**.

## Context

LangWatch has two products behind one front door:

1. **AI Governance** — track coding-agent usage, spend, and sessions per developer. Setup is three CLI commands (`npm i -g langwatch` → `langwatch login` → `langwatch claude`) and results appear on `/me` in ~30 seconds (docs: `ai-governance/track-your-claude-code-usage`).
2. **LLMOps** — traces, evaluations, datasets, prompts, experiments. Setup is SDK/MCP integration against a project API key.

The current onboarding (`langwatch/src/features/onboarding/`) is 100% LLMOps-shaped: the desires screen lists nine LLMOps options and zero governance options, and the flavour screen's "Via Coding Agent" card — the card a governance-intent user will obviously click — sets up **tracing of your application**, not coding-agent usage tracking. Governance users answer a long questionnaire about a product they didn't come for and end up in the traces surface (customer feedback: Obsidian `Articles/governance/feedback/onboarding.md`).

For existing customers, enabling `release_ui_ai_governance_enabled` engages the persona home resolver (`specs/ai-gateway/governance/persona-home-resolver.feature`, `ee/governance/services/personaResolver.service.ts`), whose Persona-2 default (personal VK + project membership → `/me`) reroutes users who never asked to move — a mess for users with multiple projects and organizations.

**Forcing function:** governance opens to **all** users (GA). Onboarding must route by intent before/with that flip.

**Blast radius calibration:** top-of-funnel signup conversion — no money/data-corruption paths in the onboarding fork itself. One adjacent data path exists (the CLI device-login gate, Decision 7) and is handled explicitly. Invariants carry analytics anchors; a red-team pass ran before lock (see Revisions v2).

**Hard constraints (confirmed 2026-07-08):**

- **C1** Reuse the existing onboarding engine (`use-generic-onboarding-flow`, screen registry) — no parallel onboarding system.
- **C2** signupData marketing fields keep flowing to `Organization.signupData` + nurturing hooks **at least on the LLMOps track**.
- **C3** Governance opens to ALL users as part of this work.
- **C4** Self-hosted parity — the fork exists in self-hosted too (today self-hosted has a 1-screen welcome).
- **C5** No CLI changes — `langwatch login` and the device flow stay exactly as shipped; this ADR is web onboarding + `/` redirection only.

**Prior ADRs this builds on:**

- **ADR-013** — onboard by what the user is doing (tool/workflow), never by identity. The intent fork follows it.
- **ADR-018** — governance ingest rides the unified trace substrate with a hidden per-org project (`kind=internal_governance`); data tenancy does not require a user-visible project.

## Decision

Numbered choices; each traces to a locked question round (R1–R3) or a constraint.

1. **The intent fork is screen 2 of the welcome flow** (R1-Q1). Screen 1 (org name + ToS) stays universal; screen 2 asks "What do you want to do?" with exactly two cards. Earliest possible signal; every later screen branches on it. Follows ADR-013.
   **Card copy must disambiguate the coding-agent-product builder** (strategy red-team S1): someone *shipping* a coding agent as their product wants LLMOps traces, and "Track AI coding agents" reads as observability for them. Copy direction: "Track **my team's** AI coding-tool **usage & spend**" vs "Trace & evaluate **the LLM app I'm building** (including coding agents)". Exact copy is pinned by a test per the copywriting standard; misroute rate is watched via O6.

2. **Intent is a first-class column: `Organization.primaryIntent`, enum `AGENT_GOVERNANCE | LLM_OPS`, nullable** (R3, superseding R1-Q4's signupData+pin design after red-team). It is an organization **setting**, not a buried JSON field and not a per-user pin: written by `initializeOrganization` on the same `Organization` row it creates (atomic by construction), readable and editable later. It is deliberately NOT in signupData — the LLMOps signupData payload stays byte-identical to today.

3. **The org intent always decides the `/` landing when set** (R3-Q1, user overruled the pin-wins recommendation — hard rule chosen). Resolver contract:
   - `primaryIntent = AGENT_GOVERNANCE` → `/me`
   - `primaryIntent = LLM_OPS` → `/{project-slug}` (the specific project still picked by existing last-visited/first-membership logic — intent decides the *kind* of home, not which project)
   - `primaryIntent = NULL` → the resolver behaves exactly as today (personas, pins, stickiness — untouched legacy path)
   - Guard: an `AGENT_GOVERNANCE` org whose governance flag has been kill-switched off must fall back to the project home, never a 404'd `/me` (invariant I8).
   The user pin and last-visited stickiness are **not consulted** when intent is set; users navigate freely after landing, but `/` is deterministic per org. Multi-org users land per the currently-selected org's intent — per-org by construction, no cross-org leakage. (On a fresh device with no stored org selection, "currently-selected" falls back to the user's first org — accepted edge, see Consequences.)
   **The rule binds BOTH routing layers** (red-team v2 F8): the server resolver is re-wrapped client-side by `resolveHomeDestination` (`pages/index.tsx:50`), which applies last-visited stickiness on top and would silently flip both intent directions. The resolver therefore returns an explicit `intentPinned: true` signal when intent decided the destination, and the client skips its pin/stickiness overrides when set — a **new** response field, deliberately not overloading `isOverride` (whose semantics are "user set an explicit pin"). Without this, the "always wins" guarantee is false for any user with visit history.
   This hard rule was **re-challenged and re-locked** after red-team round 2 (R4-Q1): the strongest counter-argument — an invited non-admin (e.g. an ML engineer in an `AGENT_GOVERNANCE` org) lands on `/me` every session with no self-serve escape, recreating the "moved without asking" complaint this ADR set out to fix — is accepted as a **conscious bet** on deterministic settings semantics. The remedy for a structurally mixed org is splitting orgs or the admin flipping the setting; O5 tracks whether this cohort's pain forces a revision.

4. **Every pre-existing organization gets `NULL` — nobody moves, ever** (R3-Q2). No backfill heuristics, no migration of behavior: legacy orgs keep today's resolver output bit-for-bit, including flag-on early-adopter orgs whose mixed-persona users land on `/me` today. An org opts into intent-based landing by setting the field in org settings. This also makes governance GA a routing non-event for every existing customer (original R1-Q3 lock, now satisfied more strongly).
   **NULL means "intent unset", not "pre-2026"** (red-team v2 F10): org creation also flows through `createAndAssign` from callers other than onboarding (backoffice `OrganizationsView`, `SubscriptionPage`, future SSO/programmatic paths), and those keep minting NULL orgs indefinitely. That is by design — NULL always resolves via the legacy path, which is the safe default. Implementers must not "fix" other callers to force a value; they set intent only when the creation flow actually knows it.

5. **The governance track is org → intent, nothing else** (R2-Q1 straight-to-setup, tightened in v4: no in-onboarding CLI screen either). Finishing the track creates the workspace and redirects to `/` — the resolver lands `/me` (R2-Q2; no admin/individual split — `/governance` is discovered via the sidebar Govern section), where the **existing** CLI install surfaces teach setup. Onboarding touches no CLI-related screen or component; the CLI experience is already working and stays untouched (C5 broadened: not just the CLI binary — every CLI setup surface). No basic-info, desires, or role screens. C2 holds: it binds the LLMOps track; the governance track contributes org name + intent only. Both tracks still silently create org + team + default project via an unchanged `initializeOrganization` shape (R1-Q2) — dozens of surfaces assume ≥1 project, and ADR-018's hidden project covers ingest tenancy only.

6. **The LLMOps track is untouched apart from the new intent screen before it** (R2-Q3). basic-info → desires → role → flavour screen stay as-is, ending at `/{project-slug}` surfaces as today. Funnel trimming is a data-informed follow-up (O1), deliberately not bundled.

7. **GA mechanics: flag rollout; the CLI 403 stays in the code as a flag-armed safety net; no CLI changes** (R2-Q4 + R3-Q3, C5). Confirmed against the code:
   - SaaS: the gate at `server/routes/auth-cli.ts:1666` consults PostHog live per org — GA = roll `release_ui_ai_governance_enabled` to 100% in PostHog; switching an org off in PostHog **re-arms the 403 for that org automatically**. Zero gate code deleted.
   - Registry `defaultValue: false → true` (`server/featureFlag/registry.ts:146`) and the auth-cli call site's hardcoded fallback `defaultValue: false → true` — this pair is what lifts the gate on **self-hosted** (memory flag service resolves from the call-site default) and during PostHog outages.
   - Residual risk, accepted and documented: with the gate open, a user who explicitly chooses AI-tools/device mode in the CLI gets a personal workspace + VK; the CLI's existing Where/How prompts (`specs/ai-governance/cli-onboarding/login-unified.feature`) are the consent step. The original silent-capture incident predates those prompts.

8. **Org intent is editable in the organization settings page, shipped in this ADR** (R3-Q4). A "Primary use" field (org-admin only) on the existing org settings surface, so a wrong pick is self-serviceable and legacy orgs can adopt intent-based landing without support/SQL.
   Two honest limits of "self-serviceable" (red-team v2 F9, strategy S1):
   - Editing intent repoints `/` — it does **not** replay the skipped onboarding track. An org that misrouted to governance never saw basic-info/desires/role, and flipping to `LLM_OPS` won't ask them retroactively; that funnel + signupData is lost for that org (accepted asymmetry).
   - A governance org flipped to `LLM_OPS` would land everyone on the silent, never-integrated default project. The settings flip to `LLM_OPS` must therefore surface the LLMOps setup path (the flavour/integration screens for that project), not just repoint the route.

9. **Self-hosted gets the same fork** (C4). Self-hosted welcome grows from 1 screen to org → intent → (governance: CLI setup rendering `langwatch login --endpoint <host>` / llmops: finish as today).

## Constants

| Name | Value | Purpose |
|---|---|---|
| Prisma enum | `OrganizationIntent { AGENT_GOVERNANCE, LLM_OPS }` | Exact enum name/values for the column |
| Column | `Organization.primaryIntent OrganizationIntent?` (nullable, no default) | NULL = legacy org, resolver untouched |
| Landing map | `AGENT_GOVERNANCE → /me`; `LLM_OPS → /{project-slug}`; `NULL → legacy resolver` | Decision 3 |
| Intent screen position | index 1 (screen 2) in both `full` and `self_hosted` flow configs | Decisions 1, 9 |
| CLI setup commands | `npm install -g langwatch` → `langwatch login [--endpoint <host>]` → `langwatch claude` | Governance setup screen; must match docs page `ai-governance/track-your-claude-code-usage` |
| Flag | `release_ui_ai_governance_enabled` — PostHog 100% rollout; registry + auth-cli fallback literals `false → true` | Decision 7 |
| Kill-switch | Per-org PostHog off-condition on the same flag | Re-arms the 403 and hides governance UI for that org |

## Invariants

| Invariant | Meaning | Satisfied by / test anchor |
|---|---|---|
| I1 | Legacy orgs (`primaryIntent = NULL`) get bit-identical resolver output before/after this release AND before/after the GA flag flip, for every persona including flag-on early adopters | Persona resolver unit tests: existing fixtures run with intent NULL × flag off/on — outputs unchanged |
| I2 | LLMOps-track screens, order, and the `initializeOrganization` signupData payload are byte-identical to today | Existing welcome-screens integration tests + signupData snapshot (intent is NOT in signupData) |
| I3 | Governance signup is 2 screens to actionable (org → intent → lands /me) | Flow-config unit test asserting the governance track screen list |
| I4 | Both tracks produce a working org + team + project; `initializeOrganization` result shape identical regardless of intent | Router integration test parameterized on intent |
| I5 | Every completed onboarding writes `primaryIntent` on the Organization row, atomically with org creation | Router test asserting the column on the created org; no separate write to fail independently |
| I6 | Conversion is instrumented per track — screen-level analytics events carry the intent | Analytics emit assertions on intent + setup screens |
| I7 | Self-hosted renders the intent screen; CLI setup shows `--endpoint` | Flow-config test on the `self_hosted` variant |
| I8 | An `AGENT_GOVERNANCE` org with the governance flag off never resolves `/` to a gated 404 — falls back to project home | Resolver unit test: intent set + flag off → `/{project-slug}` |
| I9 | When intent is set, the client redirect layer passes the server destination through untouched — no stickiness/pin re-flip | `resolveHomeDestination` unit test: `intentPinned: true` + contrary `lastVisitedHomeKind` → server destination wins |
| I10 | LLMOps funnel completion has a measured pre-release baseline and a revert trigger: if completion drops **>2% absolute** for 2 consecutive weeks post-release, the intent screen is merged into screen 1 or reverted (O11) | Funnel dashboard segmented per I6; baseline captured before release |

## Schema

```prisma
// prisma/schema.prisma — new enum + column on Organization
enum OrganizationIntent {
  AGENT_GOVERNANCE // signup intent: track coding-agent usage/spend → "/" lands on /me
  LLM_OPS          // signup intent: observe/evaluate an LLM app → "/" lands on /{project}
}

model Organization {
  // ...existing fields...
  primaryIntent OrganizationIntent? // NULL = pre-fork org; resolver legacy path. Editable in org settings.
}
```

```ts
// server/featureFlag/registry.ts — release_ui_ai_governance_enabled
defaultValue: true, // was false — Decision 7 (self-hosted + fallback path)

// server/routes/auth-cli.ts:1670 — same flag, call-site fallback
defaultValue: true, // was false — gate logic unchanged; PostHog per-org off re-arms the 403
```

No change to `sign-up-data.schema.ts` (intent deliberately not in signupData). Nurturing hooks additionally receive `primaryIntent` as an explicit trait so Customer.io can segment governance vs LLMOps signups (red-team F6).

Implementation note (red-team v2 on F5): "atomic by construction" requires threading `primaryIntent` through the full creation path — `onboarding.router` → `organization.service.createAndAssign` → `organization.prisma.repository` create — as part of the same INSERT. The service/repo signatures don't accept it today; extending them is in scope, a separate post-create write is not.

Resolver response shape (Decision 3, F8): `resolveHome` gains `intentPinned: boolean`; `resolveHomeDestination` returns the server destination untouched when it is true. New field — `isOverride` keeps meaning "user-set explicit pin".

## Rejected alternatives

- **Fork at the flavour screen / inside the desires multi-select** — governance users still traverse the LLMOps questionnaire; weak, buried signal (R1-Q1).
- **Intent in `Organization.signupData` + seeding `User.lastHomePath`** (v1 design) — red-team killed it: the pin is global and override-everything, so the seed traps users on `/me` across all their orgs permanently, bypasses the flag gate (kill-switch → 404), and has no atomicity with org creation. Superseded by the first-class column (R3).
- **Pin/last-visited above org intent** — recommended twice (R3-Q1, re-asked R4-Q1 after the strategy red-team's trapped-teammate argument), overruled twice: the org setting is the deterministic landing rule; individual overrides would dilute the "treat it as a settings" semantics. The invited-non-admin cost is accepted knowingly (Decision 3, O5).
- **Team-level or per-user intent grain** (strategy red-team S2) — the signal is per-user at signup but persists org-wide; Teams exist as a natural middle grain. Rejected with the hard rule re-lock: user/team grain adds a second column + precedence matrix + per-user settings UI for a cohort (mixed-usage orgs) the org-split remedy already covers; revisit via O5/O8 if the cohort's pain materializes.
- **Post-landing "just me / my team" qualification micro-signal** (strategy red-team S3+S4) — would split `/me` vs `/governance` landing for the buyer persona and give sales a team-size signal at near-zero funnel cost. Rejected (R4-Q2): `/me`-only landing + sidebar discovery kept; the flying-blind-on-qualification and buyer-undersell costs are accepted consciously (Consequences, O9/O10 track the revisit).
- **Backfill existing orgs to `LLM_OPS` or infer from governance signals** — both move or misfile someone; NULL-means-legacy moves no one and needs no heuristic (R3-Q2).
- **basic-info on the governance track** — overruled for speed-to-value; marketing fields stay LLMOps-only (R2-Q1).
- **Admin vs individual landing split on the governance track** — its input signal (usage style) left the track; `/governance` is wrong for the IC majority (R2-Q2).
- **No project for governance signups** — every no-project code path becomes load-bearing for zero visible gain (R1-Q2).
- **One-time GA interstitial for existing users** — interrupts every user including pure-LLMOps orgs (R1-Q3).
- **CLI-side changes to soften the 403 lift** — excluded by C5; the existing login prompts are the consent step (R3-Q3).
- **Deleting the flag / staged GA rollout** — deleting forfeits the kill-switch; staging is pointless when routing is a non-event (R2-Q4).
- **Trimming the LLMOps funnel in the same release** — doubles conversion-funnel blast radius (R2-Q3 → O1).

## Consequences

**Positive**

- Governance-intent signups reach actionable value (spend on `/me`) in 3 screens + 3 commands instead of a 5-screen LLMOps questionnaire ending in the wrong surface.
- Landing is deterministic and self-serviceable: one org setting explains (and fixes) where `/` goes — support stops debugging persona inference for intent-set orgs.
- GA moves nobody: legacy orgs are NULL, the resolver's legacy path is untouched, and the 403 safety net re-arms per org from PostHog with no deploy.
- Marketing/product gain governance-vs-LLMOps segmentation (column + nurturing trait) that is impossible today.

**Negative**

- Governance-track signups contribute no company-size/role/team-size qualification data; nurturing keys on `primaryIntent` only, and sales cannot distinguish a 200-dev org signup from a hobbyist until behavior reveals it (accepted twice: R2-Q1 and R4-Q2 after the strategy red-team argued this blinds the growth segment — O9 tracks the revisit).
- The paying governance buyer (budgets/policies/anomalies at `/governance`) first sees their *personal* usage page; the org-control story is one sidebar click away rather than the landing (accepted, R4-Q2; O10).
- "Org intent always wins" means a mixed-usage user in an intent-set org cannot re-default `/` via the picker pin or stickiness — including invited non-admins with no self-serve escape (re-challenged and re-locked, R4-Q1; conscious bet, O5). The pin/stickiness machinery remains live only for NULL orgs.
- Editing intent never replays the skipped onboarding track — an LLMOps-intent org that misrouted through governance has permanently lost that funnel's data (accepted asymmetry, Decision 8).
- Two funnels to monitor; dashboards must segment by intent or report a blended number (I6 mitigates, I10 adds the revert trigger).
- Residual CLI risk: device-mode login now provisions personal workspaces in any org; consent lives in the CLI's existing explicit mode choice (accepted, Decision 7).
- Multi-org users on a fresh device (no stored org selection) land per their first org's intent — arbitrary until they pick an org (accepted edge, red-team v2 F12).

**Neutral**

- Every org still gets a default project; governance-only orgs carry an unused invisible one (status quo pattern per ADR-018).
- The flavour screen survives unchanged on the LLMOps track, including its known UI-only-selection quirk.

## Open questions

| # | Question | Owner | Blocking? |
|---|---|---|---|
| O1 | Trim the LLMOps funnel (role screen, desires length)? Revisit with per-track funnel data ~4 weeks post-release | Sergio | No |
| O2 | Cross-routing affordances ("also monitor an LLM app?" on /me; "track coding agents?" in project home) beyond the sidebar | Sergio | No |
| O3 | ~~Governance CLI setup screen polling~~ — dissolved in v4: there is no in-onboarding CLI screen to poll from | — | Closed |
| O4 | "New" discovery banner for legacy orgs at GA (copy + dismissal persistence) — discovery is sidebar-only until decided | implementer | No |
| O5 | Hard landing rule is a DECIDED conscious bet (R4-Q1), not open — this entry tracks only the revisit signal: intent-set orgs where users repeatedly navigate away from the intent home immediately after `/` | Sergio | No |
| O6 | Intent-card misread rate (esp. coding-agent-product builders picking governance) — instrument card→completion→first-action coherence | Sergio | No |
| O7 | Should editing intent in org settings offer to replay the other track's onboarding (fixes the funnel-loss asymmetry)? | Sergio | No |
| O8 | Team-level / per-user intent grain — revisit only if O5's signal fires from structurally mixed orgs that can't reasonably split | Sergio | No |
| O9 | Post-activation governance qualification capture (team size, "for my team?") — rejected at onboarding (R4-Q2); revisit as a non-blocking /me prompt if sales blindness bites | Sergio | No |
| O10 | Buyer-persona landing (`/governance` vs `/me`) — revisit alongside O9 | Sergio | No |
| O11 | Merge the intent cards into screen 1 (org name + ToS + cards, zero added clicks) — pre-approved fallback if I10's conversion trigger fires | implementer | No |

## Revisions

- **v1 (2026-07-08)** — Initial draft. Frame: both tracks in one ADR; forcing function = governance GA; blast radius = signup conversion; constraints C1–C4. R1 locked: fork at screen 2, silent project creation, existing users don't move at GA, intent persisted (then: signupData + `lastHomePath` seed). R2 locked: governance track straight-to-setup (overruled keep-basic-info), everyone lands `/me` (admin-split dissolved), LLMOps track untouched, GA default-on with kill-switch.
- **v2 (2026-07-08)** — Red-team (devils-advocate) findings + user redesign. F1/F2/F5 (global pin traps users cross-org, bypasses the flag gate → 404 on kill-switch, non-atomic seed) invalidated the v1 persistence design → replaced by first-class nullable `Organization.primaryIntent` enum that **always** decides landing when set (R3-Q1, hard rule chosen over recommended pin-precedence). F4 (already-flag-on orgs would move) → NULL-means-legacy backfill, nobody moves (R3-Q2). F3 (403 lift re-opens ingestion misrouting) → 403 code kept as flag-armed safety net, PostHog rollout is the lift, call-site fallback literal flipped, CLI untouched per new constraint C5 (R3-Q3). F6 → `primaryIntent` added as explicit nurturing trait. F7 (I2/I5 contradiction) → dissolved: intent no longer touches signupData. Org settings editability added (R3-Q4).
- **v4 (2026-07-08, post-lock revision, user-directed)** — The governance track drops the in-onboarding CLI setup screen entirely: track = org → intent (2 screens), Finish → `/` → `/me`, where the existing CLI install surfaces (already shipped and working) teach setup. Trigger: implementation review — the screen duplicated `/me`'s surface and required touching CLI-adjacent components, which the user ruled out (C5 broadened to every CLI setup surface, not just the binary). I3 tightens to 2 screens; O3 dissolves (nothing to poll from); the `langwatch claude` third-command rendering stays exclusively on the docs page and /me.
- **v3 (2026-07-08)** — Pre-lock double red-team (technical re-verify + fresh strategy adversary). Technical: v2's F1–F7 verified genuinely closed against code; new F8 (client `resolveHomeDestination` stickiness silently overrides the server's intent decision) → Decision 3 extended to bind both routing layers via a new `intentPinned` resolver field + invariant I9; F9 → Decision 8 must surface LLMOps setup on a governance→LLM_OPS flip; F10 → NULL re-defined as "intent unset" (other `createAndAssign` callers mint NULL forever); F12 → fresh-device multi-org edge documented. Strategy: S1 → card copy disambiguation for coding-agent-product builders + non-replayable-onboarding asymmetry documented; S2 (org grain traps invited non-admins) → **R4-Q1 re-asked, hard rule re-locked as a conscious bet**, team/user grain added to rejected alternatives (O8); S3+S4 (post-landing "just me / my team" micro-signal for qualification + buyer landing) → **R4-Q2 asked, rejected**, sales-blindness and buyer-undersell accepted in Consequences (O9/O10); H1 → conversion baseline + >2%-for-2-weeks revert trigger added as I10 with screen-merge as the pre-approved fallback (O11). Open questions O6–O11 added.
