# Architecture teaching that cannot drift

Date: 2026-10-05. Branch: feat/strict-feature-layout-v0. Asked by Alex: is the architecture guide up to date and strict; should there be specialised lint-backed skills and review skills; sweep docs and dev docs that still describe the old architecture; "anything else in this area, because things slip through".

## Findings

- The guide routes, it does not enforce: it cites none of the ~75 plugin rules or the enforcer policies; `process-module` cites none, `api-transports` one.
- It misses §19, routes §3.3/§6/§11 and §4-§7 to two skills that do not exist, and none of the 2026-10-05 rulings is in the record or a skill yet.
- Its three "known disagreements" (module classes still in `app/<f>.app.ts`; `useFeatureFlag` against `useReleaseFlag`; `requestDelivery`) have waited since 2026-10-01.
- §15's deleted spellings are prose only: nothing stops a doc, skill or new code from writing one.
- What review caught today that no lint sees: weak test binds, a framework trap (`.withPermission("x", { via })` drops `via` at runtime and 500s), new `*Api` operations without a ruling, a filter whose soundness rests on lexical resolution.

## Work, in order

1. Record the day's rulings in ARCHITECTURE.md; the guide gains §19 and a "Backed by" column (lane record-rulings-2026-10-05).
2. Deleted spellings become data and a guard: a machine-readable list beside §15; teaching surfaces (CLAUDE.md, .claude/rules, .claude/skills, dev/docs outside adr and plans, best_practices) may not name one outside a deletion context; code may not add one (per-spelling ratchet, message names the replacement).
3. Reseed every teaching surface from the record (reseed-architecture), making guard 2 green on teaching surfaces.
4. Lint-backed skills: `process-composition` (§4-§7), `module-dependencies` (§3.3, §6, §11; peer cycles), a stricter `api-transports` (§8, the guard rules once E1-E9 land), `errors` (§12). Each lists the rules and policies behind it; each rule's message names its skill.
5. Review skills: `architecture-review` (scoped lint, lint:architecture, parity; then the checklist lint cannot see, by record section; findings with file:line and a section; a finding seen twice becomes a lint-rule proposal) and `spec-binding-review` (every Then proven, at the scenario's level; composition by booting the app; library behaviour is not product behaviour).
6. A check over the skills themselves: a cited rule, policy or section that does not exist fails; a house rule whose message names no skill fails.
7. Framework traps fixed where they live: `.withPermission` with a single string and `{ via }` is a type error and a runtime drop; make it one or the other in packages/api.
