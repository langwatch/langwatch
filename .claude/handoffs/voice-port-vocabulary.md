# Handoff: voice-port-vocabulary

Status: complete
Manifest: .claude/manifests/voice-port-vocabulary.md
Updated: 2026-09-12 09:55

## 1. Identity

Merge-drive lane, single attempt, task complete in one pass.

## 2. Objective

Rename main's "port" vocabulary in `modules/scenario/contract/src/voice/` to
this branch's vocabulary (repository/channel/service/Infrastructure) so
`langwatch/no-port-vocabulary` reports 0 instead of 8, with zero new baseline
rows.

## 3. Owned paths

- `modules/scenario/contract/src/voice/**`
- any file that imports a renamed symbol (searched repo-wide; none outside
  this directory — the package's only public export is `index.ts`, which does
  not re-export voice internals)

## 4. Shared paths - do not edit

None touched. `packages/architecture-lint/src/oxlint-baseline.json` shows as
modified in `git status` but that predates this lane (other work already
staged it) — verified with `git diff --cached` that this lane made no edits to
it.

## 5. Work completed

- `langwatch/no-port-vocabulary` over `modules/scenario/contract/src/voice/`:
  **8 -> 0** violations, reproduced with the exact command in the manifest.
- Renamed (rename, not delete — every symbol keeps its behaviour):
  - File `whole-call-audio.ports.ts` -> `whole-call-audio.infrastructure.ts`
  - Type `WholeCallAudioPorts` -> `WholeCallAudioInfrastructure`
    (declared in `whole-call-audio.service.ts`)
  - Function `createWholeCallAudioPorts` -> `createWholeCallAudioInfrastructure`
  - Const `wholeCallAudioPorts` -> `wholeCallAudioInfrastructure`
  - `resolveWholeCallAudio`'s `ports` parameter -> `infrastructure` (only
    caller is the test file, updated)
  - File `voice-session.ports.ts` -> `voice-session.infrastructure.ts`
  - File `__tests__/voice-session.ports.unit.test.ts` ->
    `__tests__/voice-session.infrastructure.unit.test.ts`
  - Type `VoiceSessionPorts` -> `VoiceSessionInfrastructure` (declared in
    `voice-session.service.ts`; used throughout that file and both test
    files as a type annotation only)
  - Function `createVoiceSessionPortsFromServices` ->
    `createVoiceSessionInfrastructureFromServices`
  - Function `createVoiceSessionPorts` -> `createVoiceSessionInfrastructure`
  - Const `voiceSessionPorts` -> `voiceSessionInfrastructure`
- Left lowercase local variables/parameters named `ports` (e.g. inside
  `voice-session.service.ts`'s internal functions, and test helpers like
  `fakePorts` renamed only in the whole-call-audio test — see below) as-is
  where the rule does not flag them: `no-port-vocabulary`'s regex
  (`^[A-Z][A-Za-z0-9]*Ports?`) only matches PascalCase identifiers, so a
  lowercase `ports` local is not a violation and renaming ~30 call sites
  across a 900-line file was unnecessary risk for zero lint benefit. Renamed
  `fakePorts` -> `fakeInfrastructure` in the whole-call-audio test only, since
  it was a small, contained file.
- Updated all doc-comment prose mentioning "ports" in the four production/
  test files actually edited, to say "infrastructure" instead.
- Verified no consumer of any renamed symbol exists outside
  `modules/scenario/contract/src/voice/` (repo-wide grep, package `exports`
  field is `"."` only, `index.ts` does not re-export voice internals).

## 6. Files changed

`modules/scenario/contract/src/voice/`:
- Added (renamed from `*.ports.ts`): `whole-call-audio.infrastructure.ts`,
  `voice-session.infrastructure.ts`
- Modified: `whole-call-audio.service.ts`, `voice-session.service.ts`
- `__tests__/` added (renamed): `voice-session.infrastructure.unit.test.ts`
- `__tests__/` modified: `whole-call-audio.service.unit.test.ts`,
  `voice-session.service.unit.test.ts`
- Old paths `whole-call-audio.ports.ts`, `voice-session.ports.ts`,
  `__tests__/voice-session.ports.unit.test.ts` no longer exist (staged as
  removed, not orphaned — `git status` shows clean `A`/no entry, not `AD`).

All of the above are staged (`git add -- <path>`, one file at a time, each
after its own lint/test check passed).

## 7. Checks completed

```
oxlint --disable-nested-config -c <port-rule.json> modules/scenario/contract/src/voice/
  -> 0 langwatch/no-port-vocabulary violations (was 8)
oxlint --disable-nested-config <each touched file individually>
  -> clean, exit 0
tsc --noEmit --ignoreConfig voice-session.service.ts voice-session.infrastructure.ts
  -> no errors referencing the renamed symbols (only pre-existing path-alias/
     types-node errors from running outside the project tsconfig)
pnpm --filter @langwatch/scenario-contract test:unit src/voice/__tests__/whole-call-audio.service.unit.test.ts
  -> 5 passed
pnpm --filter @langwatch/scenario-contract test:unit src/voice/__tests__/voice-session.infrastructure.unit.test.ts
  -> fails to load: Cannot find module '~/server/scenarios/scenario-event.enums'
     (pre-existing, listed out-of-scope in the manifest; confirmed same
     failure predates this lane by testing an unrelated, untouched voice test
     file with the same `~/` import)
pnpm --filter @langwatch/scenario-contract test:unit src/voice/__tests__/voice-session.service.unit.test.ts
  -> same pre-existing `~/server/scenarios/scenario-event.enums` load failure
pnpm typecheck:one modules/scenario/contract
  -> fails in the shared declarations prebuild (packages/observability
     importing `langwatch`/`langwatch/observability/node` with no .d.ts under
     sdks/typescript/dist) before reaching this package at all — pre-existing,
     outside owned paths, not caused by this rename
```

## 8. Current failure

None attributable to this lane's changes. Two pre-existing, out-of-scope
failure classes observed (both named in the manifest as expected):
`~/` path-alias resolution in this package's vitest run, and the shared
`typecheck:declarations` prebuild being broken by an unrelated package.

## 9. Exact next action

None required for this task — it is done. If the coordinator wants the
package's tests to actually execute (rather than fail to load), a separate
lane needs to fix the `~/` alias resolution for
`@langwatch/scenario-contract`'s vitest config (see
`./scenario-evaluation-result.ts`, `~/env.mjs`,
`../../../workers/voice-ws-listener`, `~/server/scenarios/scenario-event.enums`
as examples) — that is a different, pre-existing problem, not part of this
manifest.

## 10. Shared-file requests

None.

## 11. Risks

- The `ports` local variable/parameter name still appears throughout
  `voice-session.service.ts` (function bodies) and in the two ports test
  files (fixture variables, not the renamed `fakePorts` helper in the
  whole-call-audio test). This is intentional: `no-port-vocabulary` only
  matches PascalCase names, so these are not violations, and rewriting ~30
  call sites across a 900-line production file for pure cosmetic consistency
  was judged not worth the risk within this lane's scope. If a later reviewer
  wants full-word consistency, it's a pure rename with no interfaces to widen.
- `UA` (main-added, not yet resolved) files still exist in this directory —
  `voice-nonce-handoff.ts`, `voice-nonce-handoff-e2e.unit.test.ts`,
  `voice-nonce-handoff.unit.test.ts`, `voice-public-url-tunnel.ts`,
  `voice-public-url-tunnel.unit.test.ts`. They are untouched by this lane
  (outside the 8-violation set named in the manifest) and are someone else's
  merge-resolution work.

## 12. Unfinished work

None for this manifest.

## 13. Completion status

Complete: the reproduce command in the manifest reports 0 (was 8), every
touched file is staged individually with zero conflict markers and zero
`~/`/`@ee/` import regressions, no baseline entry was added or touched by this
lane, and the one runnable test suite among the touched files (whole-call-audio)
passes 5/5. The other two touched test files fail to *load* for the
pre-existing, out-of-scope `~/` resolution reason the manifest explicitly
carved out.
