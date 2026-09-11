# Handoff: merge-scenario

Status: partial
Manifest: .claude/manifests/merge-scenario.md
Model: opus (as-launched) / effort unknown (as-launched)
Updated: 2026-09-11 18:05

## 1. Identity

merge-scenario, attempt 1. No previous lane.

## 2. Objective

Resolve the 196 conflicted paths under `modules/scenario` and land the two
features main shipped after the fork (`ScenarioFieldUnknownError`,
`PENDING_EVALUATION`) in this branch's shape.

## 3. Owned paths

    modules/scenario/**

## 4. Shared paths - do not edit

    packages/handled-error/src/presentation.ts    coordinator
    packages/handled-error/src/app-codes.ts       coordinator
    packages/architecture-lint/src/*-baseline.json coordinator
    platform/**                                   NOT OURS
    everything outside modules/scenario/

## 5. Work completed

- **No conflict marker survives under `modules/scenario/`** (39 marker files, 66
  hunks, all resolved by hand).
- **rerere audit, rule 3**: 36 marker-less `UU` files checked. **2 took ours**
  (the two the manifest named), 34 were blends, 0 took theirs. Both took-ours
  files re-resolved by hand; the 34 blends were left alone.
- **`PENDING_EVALUATION` landed.** On this branch the run-status enum lives in
  `contract/src/simulation.ts` (`SimulationRunStatus`), which `scenario-run.ts`
  re-exports; the member plus main's doc comment is now there. This was a live
  break, not a cosmetic one: ~28 auto-merged files already referenced
  `ScenarioRunStatus.PENDING_EVALUATION` against an enum that did not carry it.
- **`ScenarioFieldUnknownError` and `ScenarioFieldTypeInvalidError` landed** in
  `contract/src/scenario.errors.ts` (this branch's home for scenario errors, not
  `scenario-run-parameter.error.ts`, which holds parameter errors only). Codes,
  statuses, faults and `meta` keys are byte-identical to main's.
- `contract/src/suite-fields.ts`, `scenario-field-values.ts`,
  `scenario-evaluation-gate.ts` and `voice/caller-voice.config.ts` repointed to
  branch-relative imports and exported from `contract/src/index.ts`.
- `runAwaitsEvaluations` + `UNGRADED_RUN_STATUSES` moved from
  `scenario-run-evaluators.ts` into `scenario-evaluation-gate.ts` (see Risks) so
  the fold can read the predicate without the contract taking a dependency on
  `@langwatch/evaluator-contract`.
- Fold projection carries main's evaluation-pending logic (`finishedStatusOf`,
  `settledOnFinish`, `mergeLangwatchNamespace`) with branch imports.
- Code-agent service: main's lw#3439 rewrite kept where the branch already has
  the helper (`format-execution-error.ts`). **A real bug was prevented**: taking
  ours left `await response.json()` after `await response.text()` had already
  consumed the body.
- Web: main's evaluator pills, caller column, cut-at-limit badge, whole-call
  audio, suite-field inputs and the voice flag gate wired to branch paths.
  `modules/scenario/web/src/behavior/use-voice-agents-enabled.ts` added (the
  monolith's hook has no ported home).

## 6. Files changed

All under `modules/scenario/`. Modified unless marked.

    contract/src/  simulation.ts, scenario.errors.ts, scenario-run.ts,
                   scenario-run-parameter.error.ts, scenario-execution-data.ts,
                   scenario-infra-error.ts, scenario-set-id.ts, index.ts,
                   schemas/event-schemas.ts, scenario-evaluation-gate.ts,
                   scenario-field-values.ts, scenario-run-evaluators.ts
    server/src/    projections/simulation-run-state.projection.ts,
                   services/scenario-execution-pool.service.ts,
                   services/serialized-code-agent.service.ts,
                   services/nlp-fetch.service.ts,
                   eventing/simulation-processing.commands.ts,
                   repositories/clickhouse/{simulation-clickhouse.repository.ts,
                     simulation-evaluations.columns.ts},
                   6 test files under __tests__/, intents/__tests__/ and
                   repositories/clickhouse/__tests__/
    web/src/       behavior/use-voice-agents-enabled.ts (ADDED),
                   14 files under ui/elements and ui/sections,
                   11 integration test files

## 7. Checks completed

    LC_ALL=C grep -rlF '<<<<<<<' modules/scenario/          -> prints nothing
    rtk pnpm typecheck:one modules/scenario/contract        -> 21 errors, ALL in
      packages/handled-error (conflict markers). Zero inside modules/scenario.
    rtk pnpm typecheck:one modules/scenario/server          -> same 21 errors,
      same file. The package script runs typecheck:declarations first, so it
      aborts on the shared package before compiling the scenario sources.
    tsc --noEmit in modules/scenario/contract (direct, skips the dep build)
      -> 152 errors in 32 files, EVERY ONE a `__tests__` file main added.
         Zero errors in non-test contract source.

## 8. Current failure

None inside `modules/scenario` shipped source. The two `typecheck:one` commands
cannot report on this module at all until
`packages/handled-error/src/{app-codes.ts,presentation.ts}` are resolved: their
conflict markers abort the run before it reaches us.

## 9. Exact next action

Resolve `packages/handled-error/src/app-codes.ts` and `presentation.ts` (section
10), then re-run `pnpm typecheck:one modules/scenario/contract`. It should then
report only the 32 `__tests__` files listed in section 12 item 1.

## 10. Shared-file requests

`packages/handled-error/src/app-codes.ts` and
`packages/handled-error/src/presentation.ts` are both `UU`. **Main's side already
carries the two codes this module needs.** When you resolve them, keep:

    app-codes.ts   "scenario_field_type_invalid",   (line ~459, sorted)
    app-codes.ts   "scenario_field_unknown",        (line ~460, sorted)
    presentation.ts  the whole `scenario_field_unknown: { ... }` entry (~2227)
    presentation.ts  the whole `scenario_field_type_invalid: { ... }` entry

No new copy needs writing - do not drop these two when blending.

One code has **no** registry entry and needs one:

    packages/handled-error/src/app-codes.ts
      add: "scenario_user_code_error",   (sorted, beside scenario_infra_error)

    packages/handled-error/src/presentation.ts
      add, keyed by code:
        scenario_user_code_error: {
          title: "The agent's own code raised an error",
          describe: () =>
            "The scenario ran, and the code behind the agent stopped with an " +
            "error of its own. The run detail shows what it reported.",
          remediate: "Open the run and read the error the agent reported.",
        },

It arrives with main's `ScenarioInfraErrorCode.UserCodeError` (lw#3439), which I
kept in `contract/src/scenario-infra-error.ts`. Match the neighbouring entries'
field names - I copied the shape from `agent_payload_too_large` by eye, not by
compiling it.

## 11. Risks

- **`~/` imports still resolve, and will stop.** 31 non-test and 23 test files
  under `modules/scenario` still import `~/server/...`, `~/components/...`. They
  compile today only because `platform/app/src` is still on disk mid-merge. Every
  one breaks when the monolith is deleted. Full list: `grep -rl 'from "~/'
  modules/scenario --include='*.ts*' | grep -v /dist/`.
- **`runAwaitsEvaluations` moved file.** It is main's code, unchanged, but it now
  lives in `scenario-evaluation-gate.ts` rather than `scenario-run-evaluators.ts`,
  because the latter needs `EvaluatorWithFields` from `@langwatch/evaluator-contract`
  and adding that dependency was out of my remit. If the coordinator adds the
  dependency, move it back and delete the copy - do not leave two.
- **`VOICE_CALL_SCENARIO_SET_ID` placed by me** in
  `contract/src/scenario-set-id.ts` (value `"voice-calls"`, from main's
  `platform/app/src/server/agents/voice/voice-agent.config.ts`). The clickhouse
  repository needs it to exclude voice runs from set listings and it had no home.
  When the voice agent config is ported it must import this, not redeclare it.
- **Main's execution-pool voice work is dropped**, with reason: main added
  `VoiceConcurrencyGate`, `JobNotAcceptedByPoolError`, a per-project voice cap and
  a job admission predicate to `execution-pool.ts`. `VoiceConcurrencyGate` lives
  in the monolith and this branch rewrote the pool as a service behind a port, so
  blending it is a port, not a merge. I took ours and stripped main's leftovers.
- **Main's `RecordEvaluationsCommand` and DI-carrying `QueueRunCommand` are
  dropped** from `eventing/simulation-processing.commands.ts`, same reason: the
  UA files `eventing/{queueRun,recordEvaluations}.command.ts` are in place but
  carry `~/` imports, so exporting them would break the build.
- **One behaviour assertion taken from main unverified**: `run-dialog.integration
  .test.tsx` now asserts the dialog navigates to the results tab on run
  (`mockRouterPush` called). Ours asserted no navigation. I took main's because
  `use-run-dialog-submit.ts` blended from main. Nobody has run that test.
- `web/src/ui/elements/scenario-form.tsx`: I removed main's `<CallerVoiceSection>`
  render believing `CallerVoiceModelSelect` had no home. It **does** -
  `web/src/ui/sections/scenarios/CallerVoiceModelSelect.tsx` was placed as UA. The
  `callerVoice` schema field and its defaults are still there, so re-adding the
  section is a small job (item 4).
- `suite-name-heading.tsx` is `UD` and nothing on this branch imports it; main
  deleted it in #7867. It is still on disk. Recommend `git rm` it.
- The two `repro-bug*.json` fixtures are `UD` and **must be kept**:
  `server/src/__tests__/serialized-workflow-agent.integration.test.ts` still reads
  both. Main deleted them with the monolith test, not the capability.

## 12. Unfinished work

1. 32 UA `__tests__` files in the contract (voice, evaluations, suite fields) do
   not compile: monolith relative paths and `vi.mock` targets. 152 errors, no
   shipped source among them. One pass of import repointing.
2. Repoint the 31 non-test `~/` importers (Risks item 1). `contract/src/voice/**`
   (9 files) and `contract/src/evaluations/**` (2) are the bulk; two need
   decisions, not repointing: `evaluator-attachments.ts` wants `AvailableSource` /
   `NestedField`, which live in `modules/prompt/web` (a web package a contract
   must not import), and `scenario-run-evaluators.ts` wants `EvaluatorWithFields`
   from `@langwatch/evaluator-contract` (a new dependency).
3. Port decision for the execution pool's voice gate and the two eventing
   commands (Risks items 4 and 5). Coordinator's call, not a lane's.
4. Re-add `<CallerVoiceSection>` to `web/src/ui/elements/scenario-form.tsx`,
   importing `CallerVoiceModelSelect` from
   `../sections/scenarios/CallerVoiceModelSelect.tsx` (which itself needs item 2).
5. `modules/scenario/web` was never type-checked - it is not in the manifest's
   checks and the shared package blocks every run anyway.
6. No test was executed by this lane. `modules/scenario/server` and
   `modules/scenario/web` suites are unrun.

## 13. Completion status

Partial, and the part that landed is the part that mattered: both named features
are in this branch's contract, no conflict marker survives under
`modules/scenario`, and the shipped (non-test) source of the contract compiles
clean. What remains is import repointing across main's 118 added files and three
porting decisions that are the coordinator's, not a lane's. The resolutions are
independently committable - nothing here waits on another lane except the two
`packages/handled-error` files in section 10.
