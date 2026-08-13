# ADR-015: Scenario maxTurns and minTurns threaded from platform UI to SDK

Date: 2026-08-13
Status: Proposed
> One-line: add nullable **maxTurns** and **minTurns** columns to the **Scenario** Prisma model, thread them through **ScenarioConfigSchema** → **ChildProcessJobData** → **ScenarioRunner.run()**, and expose them in a collapsible **Advanced** section in the scenario editor drawer.

## Context

The `@langwatch/scenario` SDK accepts `maxTurns` (default 10) and `minTurns` (default unset) in its `ScenarioConfig` interface. The platform never stored or passed either value — every run used the SDK default.

Customer request: let users configure turn limits per scenario from the platform UI.

Forcing function: SDK v1.2.0 ships `minTurns` (PR langwatch/scenario#900, ADR-005), and the platform must re-vendor anyway. Adding both fields in the same PR avoids a second migration.

Prior art:
- ADR-005 (Obsidian vault) — locked the `minTurns` SDK design; deferred "whether the platform UI ever surfaces minTurns" as a non-blocking open question. This ADR resolves that.
- `simulatorModel`/`judgeModel` on the `Scenario` model (`schema.prisma:2129-2130`) follow the same nullable-optional pattern, but they thread outside `ScenarioConfigSchema` because they need cascade resolution (suite > scenario > project default). `maxTurns`/`minTurns` don't need that cascade — they go directly on `ScenarioConfigSchema`.

Constraints (locked in Phase 1):
- Scenario-level, not suite-level (suite override is a follow-up).
- SDK default applies when unset (platform doesn't embed the default value).
- Same threading pattern as `simulatorModel`/`judgeModel` through Prisma → TRPC → prefetcher → child process.
- No breaking change to queued jobs (fields are optional).

## Decision

1. **Add `maxTurns Int?` and `minTurns Int?` to the Prisma `Scenario` model**, after `judgeModel`. Nullable — `NULL` means "use SDK default". Rejects: storing in a JSON config blob (breaks the typed threading path); storing in localStorage (doesn't reach the child process).

2. **Place both fields on `ScenarioConfigSchema`** (`types.ts:231`), not alongside `simulatorModel`/`judgeModel`'s cascade path. They're scenario definition properties that need no resolution — set or not. Rejects: mirroring the model cascade pattern (unnecessary complexity; no suite-level override in scope).

3. **Thread through two manual wiring sites.** Both `fetchScenario()` (`data-prefetcher.ts:479-484`) and `ScenarioRunner.run()` (`scenario-child-process.ts:173-189`) cherry-pick fields explicitly — they do NOT spread the `scenario` object. Adding to `ScenarioConfigSchema` alone does nothing. Implementation must update both sites:
   - `fetchScenario()`: add `maxTurns` and `minTurns` to the config object returned
   - `scenario-child-process.ts`: add both to the first arg of `ScenarioRunner.run()`
   
   Note: unlike `situation` → SDK `description` rename at `scenario-child-process.ts:176`, `maxTurns`/`minTurns` pass through as-is (names match the SDK interface). Rejects: a separate config channel (adds fields to ChildProcessJobData outside the scenario object).

4. **Minimal platform validation: type only.** `maxTurns`: positive integer (≥ 1). `minTurns`: non-negative integer (≥ 0). No upper cap, no cross-validation of `minTurns ≤ maxTurns` — the SDK validates at startup and returns a clear error. Rejects: duplicating SDK validation on the platform (the SDK is the authority; platform validation would drift).

5. **Collapsible "Advanced" section in the scenario form**, below the criteria/labels fields. Contains `maxTurns` and `minTurns` inputs. Rejects: config popover in footer (more complex, less discoverable); inline fields (clutters the primary form).

6. **Re-vendor SDK to v1.2.0 in the same PR.** Without re-vendoring, `minTurns` would be stored but silently ignored by the 1.1.0 SDK. Rejects: separate re-vendor PR (extra review cycle, and `maxTurns` alone is less useful).

7. **One-off, not scaffolding.** Two config fields at an existing seam — first occurrence, low blast radius, nothing to abstract.

## Constants

| Name | Value | Purpose |
|---|---|---|
| `maxTurns` column | `Int?`, default `NULL` | `NULL` → SDK default (currently 10) |
| `minTurns` column | `Int?`, default `NULL` | `NULL` → SDK default (unset = no floor) |
| Vendored SDK | `langwatch-scenario-1.2.0.tgz` | Includes minTurns support (PR #900) |

## Invariants

| Invariant | Meaning | Test anchor |
|---|---|---|
| NULL → SDK default | Unset fields produce identical behavior to pre-change runs | Existing scenario tests stay green without modification |
| Optional parsing | `ChildProcessJobData` without maxTurns/minTurns still parses | Zod schema uses `.optional()` — in-flight jobs from before the deploy parse correctly |
| Form → DB → SDK | A value set in the form reaches `ScenarioRunner.run()` | Integration: save scenario with maxTurns=3, run, assert SDK receives maxTurns=3 |

## Assumptions

| Assumption | What breaks if false |
|---|---|
| SDK `ScenarioRunner.run()` config shape won't change | Child process wiring breaks if SDK renames/moves `maxTurns`/`minTurns` |
| No suite-level override needed now | If suite-level is needed soon, maxTurns on ScenarioConfigSchema can't cascade — would need a separate field like simulatorModel |
| SDK validates `minTurns ≤ maxTurns` reliably | If SDK validation has bugs, users see a runtime error with no platform-side guard |

## Gates

| Path | Reversible? | Blast radius | Gate |
|---|---|---|---|
| Prisma migration (add nullable columns) | Yes (drop columns) | Low — additive only, no data touched | Human review (this ADR + PR review) |
| ScenarioConfigSchema change | Yes (revert) | Medium — affects ChildProcessJobData parsing for new jobs | Automated: zod `.optional()` ensures backward compat |
| SDK re-vendor 1.1.0 → 1.2.0 | Yes (revert tarball) | Medium — new SDK behavior for all runs | Existing test suites + smoke tests |
| UI Advanced section | Yes (revert) | Low — no existing UI contract | Manual QA |

## Schema

```prisma
model Scenario {
  // ... existing fields ...
  judgeModel      String?
+ maxTurns        Int?
+ minTurns        Int?
  lastUpdatedById String?
  // ...
}
```

```sql
-- Migration: add_scenario_turn_config
ALTER TABLE "Scenario" ADD COLUMN "maxTurns" INTEGER;
ALTER TABLE "Scenario" ADD COLUMN "minTurns" INTEGER;
```

## Rejected alternatives

- **Config popover in drawer footer** — more complex implementation, less discoverable than an inline section.
- **Inline form fields** — clutters the primary form with secondary config.
- **Cascade resolution like simulatorModel** — unnecessary complexity; no suite-level override in scope.
- **Platform-side cap at 100** — arbitrary; SDK is the authority on valid ranges.
- **Platform-side cross-validation (minTurns ≤ maxTurns)** — duplicates SDK logic; would drift.
- **Separate re-vendor PR** — extra review cycle for no benefit.
- **JSON config blob instead of columns** — breaks typed Prisma threading.

## Consequences

- **Positive:** Users can configure turn limits per scenario from the UI; platform threads the full SDK config surface (maxTurns + minTurns) in one change.
- **Negative:** A Prisma migration is required (additive, nullable — low risk). Platform doesn't validate `minTurns ≤ maxTurns` — invalid combos surface as SDK runtime errors, not form errors.
- **Neutral:** The SDK's default (10 turns) is shown as placeholder text ("Default: 10") when `maxTurns` is unset, so users can see the implicit cap before setting `minTurns` above it.

## Open questions

- Suite-level `maxTurns`/`minTurns` override — deferred, not blocking. Would follow the `simulatorModel`/`judgeModel` cascade pattern when needed.

## Revisions

- **v1 (2026-08-13, captain: Sergio Esteban)** — Initial draft. Locked: ScenarioConfigSchema home, minimal validation, collapsible Advanced section, bundled re-vendor, one-off scaffolding.
- **v2 (2026-08-13)** — Red-team pass. Fixed: explicit manual wiring sites (P1), added SDK default placeholder text for maxTurns UX (P2), noted situation→description rename precedent.
