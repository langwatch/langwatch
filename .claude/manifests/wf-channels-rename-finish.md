# Manifest: wf-channels-rename-finish

Objective: `modules/workflow/server` typechecks and its unit tests pass, so the adapters-to-channels rename already in the working tree can be committed and the tree can reach zero dirty.
Owner: wf-channels-rename-finish
Model: sonnet   <20 errors of four known kinds in four files; the only judgment is where two missing types come from, and importing them from the wrong package is a lint violation Haiku would not recognise>
Budget: 70 tool calls or 45 minutes, whichever comes first
Handoff: .claude/handoffs/wf-channels-rename-finish.md

## Context

The working tree holds an **uncommitted, nearly-complete** rename: workflow's
`src/adapters/` directory is gone, its contents moved to `src/channels/` and
`src/services/` with `.adapter.ts` becoming `.channel.ts` / `.service.ts`. The
old test files are staged as deleted and their replacements are already tracked
at the new paths, so no test was lost - do not go looking for missing tests.

It is not committed because it does not typecheck. Your job is only to finish it.
This is the last thing standing between the tree and zero dirty, which a main
merge needs before it can start.

**Do not re-do or re-plan the rename.** Do not move any more files, do not rename
anything, do not create a `ports/` or `adapters/` directory. The shape is already
correct.

## The 20 errors, measured at `d5c2db2822`

| Count | Code | File | What it is |
| --- | --- | --- | --- |
| 16 | TS1205 | `src/index.ts` | re-exporting a type under `verbatimModuleSyntax` needs `export type` |
| 2 | TS2304 | `src/app/workflow.app.ts:840,846` | `LanguageModel` and `ModelRole` are not in scope - the import was lost in the move |
| 1 | TS1484 | `src/services/workflow-project-environment.service.ts` | a type-only import must say `import type` |
| 1 | TS1484 | `src/services/nlp-lambda-runtime.service.ts` | the same |

Reproduce with `rtk pnpm typecheck:one modules/workflow/server`.

The 16 and the 2 TS1484s are mechanical. The TS2304 pair is the one place you can
get it wrong: find where `LanguageModel` and `ModelRole` are actually declared
before importing them, and prefer the contract package the rest of this file
already imports from.

## Owned paths

    modules/workflow/server/src/index.ts
    modules/workflow/server/src/app/workflow.app.ts
    modules/workflow/server/src/services/workflow-project-environment.service.ts
    modules/workflow/server/src/services/nlp-lambda-runtime.service.ts
    modules/workflow/server/src/channels/**
    modules/workflow/server/src/services/**
    modules/workflow/server/src/testing.ts

If a fifth file needs to change to reach green, that is fine **inside
`modules/workflow/server/src/`** - say so in the handoff. Outside it, stop.

## Shared paths - stop and request

    packages/runtime-composition/**            coordinator (just changed - read it, do not edit)
    modules/workflow/contract/**               coordinator
    apps/worker/**                             another lane - LIVE
    apps/api/**                                coordinator
    packages/architecture-lint/src/*-baseline.json   coordinator

## Read-only reference paths

    modules/workflow/server/src/channels/http/http.workflow-nlp-runtime.channel.ts
        an already-converted channel, for the shape and the import style
    modules/workflow/server/src/services/workflow-studio-dsl.service.ts
        an already-converted service
    modules/workflow/server/src/channels/__tests__/workflow-nlp-lambda.channel.unit.test.ts
        a test at its new path, already tracked and green

## Invariants

- The rename stays as it is. No file moves, no new directory, no `adapters/`.
- `export type` / `import type` are the fix for TS1205 and TS1484. Do **not**
  reach for `verbatimModuleSyntax: false`, a `// @ts-expect-error`, a `any`, or a
  `skipLibCheck` change - the error is telling you the truth.
- Do not delete, skip or weaken a test to reach green.
- Do not add a re-export for backwards compatibility. A previous lane added four
  and reported them as "no wire difference"; they were reverted.
- No new dependency.
- The two missing types are imported from where they are declared, not
  re-declared locally.

## Checks

    rtk pnpm typecheck:one modules/workflow/server
    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/workflow-server test:unit

Both must be green. Never a whole-tree check, never `pnpm typecheck`, never `CI=1`.

## Stop conditions

- a fix needs a file outside `modules/workflow/server/src/`
- `LanguageModel` / `ModelRole` cannot be found anywhere, or the only source is a
  package this one may not import
- a test fails for a reason the rename did not cause - record it, do not fix it
- the budget is reached

## Completion criteria

- `rtk pnpm typecheck:one modules/workflow/server` exits 0
- `@langwatch/workflow-server` unit tests pass, none deleted or skipped
- no file moved, created or deleted
- the handoff lists every file changed and, for the TS2304 pair, says where the
  two types were imported from and why that source
