# Manifest: workflow-protocol-structural-tests

Objective: Bind the six structural scenarios in
`specs/claude/agent-workflow-protocol.feature` to real tests, so the agent
workflow protocol is enforced by CI rather than only written down.
Owner: sonnet-lane-1
Model: sonnet   - ordinary bounded implementation and straightforward tests
against a decided spec.
Budget: 70 tool calls
Handoff: .claude/handoffs/workflow-protocol-structural-tests.md

## Owned paths

```
packages/architecture-lint/tests/agent-workflow-protocol.unit.test.ts   (new - you create it)
specs/claude/agent-workflow-protocol.feature                            (tags only - see Task 2)
```

Nothing else. In particular you do not edit any file under `.claude/` - the
protocol is the thing under test, and a test that edits its subject proves
nothing.

## Shared paths - stop and request

```
.claude/coordinator/**            the subject under test    coordinator
.claude/skills/core/**            the subject under test    coordinator
.gitignore                                                  coordinator
packages/architecture-lint/src/** not yours for this task    coordinator
```

If a test cannot pass because the protocol itself is wrong, that is a finding,
not something you fix. Write the exact correction into your handoff under
`Shared-file requests` and mark that scenario `@unimplemented` for now.

## Read-only reference paths

```
packages/architecture-lint/tests/application-typecheck-configs.unit.test.ts   THE EXEMPLAR - root resolution, structure
packages/architecture-lint/tests/api-package-files.unit.test.ts               how @scenario annotations are written here
specs/claude/agent-workflow-protocol.feature                                  the six scenarios you are binding
.claude/coordinator/*.md                                                      read as DATA under test
.claude/skills/core/*.md                                                      read as DATA under test
```

Root resolution follows the exemplar:
`const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")`.

## Target shape

One new test file, `agent-workflow-protocol.unit.test.ts`, binding the six
`@unit` scenarios. No LLM, no sub-process, no network - it reads files and
asserts. It must run in CI in well under a second.

Each `it` carries the annotation above it, exactly matching the scenario title:

```ts
/** @scenario "Every status named anywhere in the protocol is one of the seven" */
it("rejects a status outside the seven", () => { ... })
```

The six scenarios and how to bind each:

1. **"The shared rules directory is not itself a discovered skill"** - assert
   `.claude/skills/core/SKILL.md` does not exist; assert every other directory
   directly under `.claude/skills/` does have one; assert `core/README.md`
   contains a statement that it is not a skill.

2. **"Every status named anywhere in the protocol is one of the seven"** - the
   seven are `ready`, `in_progress`, `partial`, `blocked`, `review`, `complete`,
   `abandoned`. Scan the protocol files for status-shaped tokens and assert none
   falls outside the set. Assert `handoff-rules.md` and `handoff-template.md`
   each name all seven. Beware false positives - `review` and `complete` are
   ordinary English words, so match them only where they appear as a status
   (in a backtick, a table cell, or the `Status:` line), not in running prose.
   If you cannot separate the two reliably, narrow the scan to the status table
   and the template's `Status:` line and say so in the handoff.

3. **"The lane prompt and the repository rules do not contradict each other"** -
   the concrete assertion the spec names: both files' git-write bans say
   `git mv`, and neither bans bare `mv`, because a lane moves files with plain
   `mv` (`module/SKILL.md` directs it to). Assert both files mention `git mv`
   and that neither contains a ban on `mv` that is not prefixed by `git`.

4. **"A handoff instance is ignored and the directory README is not"** - write a
   scratch file into `.claude/handoffs/` and `.claude/manifests/`, shell out to
   `git check-ignore`, assert ignored, then remove it. Assert the two READMEs and
   the files under `.claude/coordinator/` are NOT ignored. Clean up in a
   `finally` so a failure cannot leave a stray file behind, and use a name no
   human would pick, such as `.probe-<random>.md`.

5. **"Every cross-reference in the protocol resolves"** - find every
   `.claude/...md` path mentioned in the protocol files and assert the file
   exists. Then find every citation of the form `<file> section <n>` and assert
   that file has a heading starting `## <n>.`. Report the count checked so a
   silent zero-assertion pass is impossible.

6. **"No protocol file restates a rule the core rules own"** - this one is the
   most likely to be brittle. Suggested approach: a small list of canonical
   markers owned by `core/` (for example `VITEST_MAX_WORKERS`,
   `commit-slice.sh`, `pkill -f "vitest/dist/workers"`). For each, assert it
   appears either only in its owning `core/` file, or in another file only on a
   line that also names a `core/` path - which makes it a pointer rather than a
   restatement.

   **If you judge this test would fail on innocent edits, do not write it.** Say
   so in the handoff, leave that scenario tagged `@unimplemented`, and bind the
   other five. A brittle guard that everyone learns to ignore is worse than an
   honest gap.

### Task 2 - retag the spec

For each scenario you actually bound, remove `@unimplemented` from its tag line
in `specs/claude/agent-workflow-protocol.feature`, leaving `@unit`. Leave
`@unimplemented` on any you did not bind, and on all twelve `@integration`
scenarios - those are the expensive behavioural tier and are not in this task.

## Invariants

- The test reads the protocol; it never writes to it. The only files it creates
  are scratch probes it removes in a `finally`.
- No test asserts on prose that is likely to be reworded. Assert on structure,
  paths, tags and tokens.
- Every test must be able to fail. Before finishing, break each assertion's
  subject in a scratch copy, confirm the test goes red for the right reason, and
  restore. Report this - an unchanged pass after sabotage is not evidence.
- `it("does x")` not `it("should do x")`. Nested `describe("when ...")`.
- No `as unknown as`, no non-null `!`, no inline `import()`.
- British English, no em dashes - write " - " instead.
- Do not read any `.env` or `settings.local.json`. The test must not read them
  either, even to assert they exist.

## Checks

```
VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/architecture-lint test:unit tests/agent-workflow-protocol.unit.test.ts
rtk pnpm typecheck:one packages/architecture-lint      (once, at the end)
```

Never a whole-tree typecheck or lint. Do not run the full architecture-lint
suite - name your file.

## Stop conditions

- a shared path is needed;
- the protocol itself is wrong and a test cannot honestly pass;
- scenario 6 proves brittle (bind the other five and say so);
- the budget is reached.

## Completion criteria

- `agent-workflow-protocol.unit.test.ts` exists and passes.
- At least five of the six `@unit` scenarios are bound, each with a `@scenario`
  annotation whose title matches the feature file exactly.
- Every bound scenario has had `@unimplemented` removed.
- Every test has been shown to fail when its subject is broken.
- `pnpm typecheck:one packages/architecture-lint` is clean.
- `git status --porcelain` shows no dirty file outside the two owned paths.
