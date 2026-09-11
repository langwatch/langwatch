# Handoff: workflow-protocol-structural-tests

Status: review
Manifest: .claude/manifests/workflow-protocol-structural-tests.md
Updated: 2026-09-11 12:45

## 1. Identity

Task workflow-protocol-structural-tests, lane sonnet-lane-1, attempt 1 (fresh
lane, no prior handoff existed).

## 2. Objective

Bind the six structural scenarios in `specs/claude/agent-workflow-protocol.feature`
to real tests. Five bound; scenario 6 left unbound as a deliberate judgment call
(see section 11).

## 3. Owned paths

```
packages/architecture-lint/tests/agent-workflow-protocol.unit.test.ts   (new)
specs/claude/agent-workflow-protocol.feature                            (tags only)
```

## 4. Shared paths - do not edit

```
.claude/coordinator/**            (read as data under test, not touched)
.claude/skills/core/**            (read as data under test, not touched)
packages/architecture-lint/src/** (not touched)
```

## 5. Work completed

Five `@unit` scenarios bound with a passing test each (7 `it` blocks total,
one scenario got two tests for its two `Then` clauses):

1. "The shared rules directory is not itself a discovered skill" - asserts
   `core/` is the only directory under `.claude/skills/` with no `SKILL.md`,
   and `core/README.md` matches `/not a skill/i`.
2. "Every status named anywhere in the protocol is one of the seven" - scans
   table rows, `Lane reports \`x\`` events and `Status: <...>` lines across
   all nine protocol files for status-shaped tokens; asserts each is one of
   the seven; separately asserts `handoff-rules.md` and `handoff-template.md`
   each name exactly the seven.
3. "The lane prompt and the repository rules do not contradict each other" -
   asserts `LANE.md` and `repository-rules.md` both contain `` `git mv` `` and
   both contain "Plain shell `mv` is fine" (whitespace-tolerant, since the
   phrase wraps across a line in `LANE.md`).
4. "A handoff instance is ignored and the directory README is not" - writes a
   `.probe-<random>.md` into `.claude/handoffs/` and `.claude/manifests/`,
   shells to `git check-ignore`, asserts both probes are ignored and both
   READMEs plus every file under `.claude/coordinator/` are not; cleans up in
   `finally`.
5. "Every cross-reference in the protocol resolves" - finds every
   `.claude/...md` path mentioned in the nine protocol files and asserts it
   exists (9 found, all resolve); finds every `<file> section <n>` citation
   (3 found, across a line-wrap in one case) and asserts the cited file has a
   `## <n>.` heading. Both assertions report a non-zero checked count.

All seven tests were shown capable of failing: for each assertion I ran the
exact extraction/comparison logic against deliberately corrupted synthetic
input (a scratch mirror of the skills directory, a hand-built bad status
table row, a stripped "Plain shell mv is fine" phrase, a dangling `.md`
reference, a wrong section number) and confirmed it flagged the defect,
without ever writing to the real subject files. Two genuine bugs were found
and fixed this way before the final pass: my status-token scan initially
false-flagged `handoff-rules.md`'s placeholder `Status: <one of the seven>`
line as if it enumerated statuses (fixed by requiring `|` in the bracket
before treating it as an enumeration), and my "Plain shell mv is fine" check
used a literal substring that broke on `LANE.md`'s line-wrapped phrasing
(fixed with a whitespace-tolerant regex).

## 6. Files changed

- `packages/architecture-lint/tests/agent-workflow-protocol.unit.test.ts` - added, 191 lines, 7 tests.
- `specs/claude/agent-workflow-protocol.feature` - modified: removed
  `@unimplemented` from the tag line of the five scenarios above, leaving
  bare `@unit`. Scenario 6 and all twelve `@integration` scenarios untouched.

## 7. Checks completed

```
VITEST_MAX_WORKERS=2 pnpm --filter @langwatch/architecture-lint test:unit tests/agent-workflow-protocol.unit.test.ts -> 7 passed
pnpm typecheck:one packages/architecture-lint -> 0 errors in my file; 3 pre-existing errors remain in src/policies/feature-shape.ts and tests/baseline.unit.test.ts, neither touched by me (feature-shape.ts already shows M in git status from other in-flight work; baseline.unit.test.ts has no diff at all, so its error predates this lane)
git status --porcelain specs/claude/agent-workflow-protocol.feature packages/architecture-lint/tests/agent-workflow-protocol.unit.test.ts -> only these two paths dirty, both mine
```

## 8. Current failure

None in my file. Two pre-existing errors outside my owned paths (see section
7) keep the package's overall `typecheck:one` from being fully clean - not
something this task can fix without touching `packages/architecture-lint/src/**`,
which is explicitly not mine this task.

## 9. Exact next action

Nothing required to finish this task. The coordinator should: read the diff of
the two files named in section 6, confirm the 7-test run and the
typecheck:one result above, then commit by pathspec naming exactly those two
paths. If the two pre-existing `feature-shape.ts` / `baseline.unit.test.ts`
errors matter for this slice's mergeability, that is a separate task against
`packages/architecture-lint/src/**`, not this one.

## 10. Shared-file requests

none.

## 11. Risks

Scenario 6 ("No protocol file restates a rule the core rules own") was left
`@unimplemented`, per the manifest's explicit permission to skip it if it
would fail on innocent edits. I judged it would: I probed the manifest's own
suggested markers (`VITEST_MAX_WORKERS`, `commit-slice.sh`, `pkill -f
"vitest/dist/workers"`, `git add -A`, `haven logs backend`) against the nine
protocol files. `git add -A` appears in both `repository-rules.md` (core,
canonical) and `COORDINATOR.md` section 7, with no link back to core on that
line - which is either a genuine restatement bug, or legitimate
reinforcement of a critical rule for the coordinator's own commit procedure
(which core does not cover, since core's rule is written for the general "no
lane writes to git" case and the coordinator is the one agent that does write
to git). A grep-based test cannot tell these apart, and picking "the right"
canonical markers is itself an editorial judgment that drifts with prose. A
brittle guard here would fail on the next honest edit to either file. Suggest
this scenario either stays structural-@unimplemented permanently in favour of
a human review step, or is redesigned as an `@integration` scenario that asks
an LLM to judge restatement-vs-pointer rather than grep for it.

No other risks. The test suite is read-only against its subject by
construction (all writes are scratch probes removed in a `finally`), and the
sabotage exercise never touched a real protocol file.

## 12. Unfinished work

1. Scenario 6 is unbound (see Risks). Whoever picks this up should read this
   section before attempting a grep-based version - it was tried and judged
   too brittle.
2. Nothing else remains from this manifest's Task 1 or Task 2.

## 13. Completion status

Complete for the five scenarios this lane could bind honestly: the new test
file passes 7/7, every assertion was proven capable of failing, `typecheck:one`
is clean for the file this lane owns, and the spec retag lands correctly with
scenario 6 and the twelve `@integration` scenarios left untouched. Ready to
commit as one coherent slice.
