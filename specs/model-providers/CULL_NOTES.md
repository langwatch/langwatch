# Phase 1 cull notes — model-providers

Date: 2026-04-26
Branch: `audit/unimpl-model-providers-2026-04-25`
Soldier: Claude (Opus 4.7)

## Removed

| File | Scenario | Class | Action |
|------|----------|-------|--------|
| specs/model-providers/default-provider.feature | Show "Default Model" badge when default model belongs to provider | DUPLICATE | Removed — canonical copy lives in `provider-list.feature` (badge is rendered on the providers list page, not the drawer). |
| specs/model-providers/default-provider.feature | Hide "Default Model" badge when default model does not belong to provider | DUPLICATE | Removed — canonical copy lives in `provider-list.feature`, same rationale. |

## NEEDS-REVIEW (left in place)

The audit summary in `AUDIT_MANIFEST.md` claims `DUPLICATE = 2`, but the table contains
**4** DUPLICATE rows. The two extra rows (in `custom-models-management.feature`) have
rationales that contradict the brief's DUPLICATE rule ("remove the scenario from this
`.feature` file"):

| File | Scenario | Manifest rationale | Why left in place |
|------|----------|--------------------|-------------------|
| specs/model-providers/custom-models-management.feature | Custom Models section appears in provider drawer | "Already covered by existing test `CustomModelsSection.test.tsx`. The Phase 1 step is to add a `@scenario` JSDoc binding to that test rather than write a new one — flagging as DUPLICATE to avoid double-binding work." | Rationale explicitly says **bind**, not delete. Removing the scenario would also delete the binding target, defeating the stated intent. Keep for Phase 3. |
| specs/model-providers/custom-models-management.feature | Add button shows options for model types | "Already covered by `CustomModelsSection.test.tsx`. Bind via @scenario JSDoc; no new test." | Same reason — the row asks for a binding action, not removal. |

Per `CULL_BRIEF.md` safety clause: "If the manifest row's rationale conflicts with what
the .feature file actually says (e.g. row says DELETE but the scenario looks legitimate),
tag the row with `(NEEDS-REVIEW)` in `CULL_NOTES.md`, leave the scenario in the .feature
file, and continue with the next row."

These two rows should be re-classified before Phase 3 — likely to `KEEP` (with a note
that the binding target already exists) rather than `DUPLICATE`.

## Counts

- DELETE rows in manifest: 0 — none applied
- DUPLICATE rows in manifest: 4 — 2 applied (default-provider.feature), 2 deferred (NEEDS-REVIEW)
- `@unimplemented` count in `specs/model-providers/` after cull: 96 (was 98)
