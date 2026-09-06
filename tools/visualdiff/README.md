# visualdiff

`visualdiff` renders every route and every flow in `visualdiff.yaml` on **two
refs of this repository at once** and reports every screen that differs — the
pixels, the console errors, the failed requests and the steps that only worked
on one side.

It exists because a large refactor moves hundreds of screens, and the failure
mode is not a red test: it is a screen that still renders, still looks right,
and quietly lost the endpoint behind it.

```text
visualdiff run [-base REF] [-candidate REF] [-routes-only] [-flows a,b]
               [-viewport 1440x900] [-config visualdiff.yaml] [-root DIR]
               [-base-port N] [-run-dir DIR] [-boot-timeout DUR]
               [-dry-run] [-keep] [-agent]
```

Exit status is `0` for no findings, `1` for findings, `2` when the run could
not be completed — the same ladder as `apidiff`.

## What a run does

1. `git worktree add --detach` for each ref, into `.visualdiff/<timestamp>/`.
2. `pnpm install --offline` and `pnpm run start:prepare:files` in each.
3. Starts each ref's stack on its own ports — the base at `-base-port`
   (5670 by default), the candidate ten above it, so the two can never
   collide. A modular checkout runs `dev:ui`, `dev:api` and `dev:worker`; a
   monolith checkout runs `dev:app` with the Prisma, ClickHouse and
   provisioning steps skipped, because both refs share your local databases
   and the older ref must not re-apply its own migration set over them.
4. Polls both stacks until they answer, then seeds a handful of traces and one
   dataset through the **candidate's** API, so the fixtures exist in the shape
   the newer code writes.
5. Runs `@langwatch/visual-diff-runner` (Playwright) over both stacks: every
   route, then every flow, screenshotting as it goes and diffing each pair.
6. Writes `report.html`, `findings.md` and `findings.json` into the run
   directory.
7. Tears both stacks down by process group through
   `dev/scripts/kill-dev-tree.sh`, verifies the ports are free, and removes
   both worktrees — on every exit path, including a failed boot.

Start with `-dry-run`: it prints the plan, the ports and the flow list and
starts nothing.

## Classification

The report's first pass is rule-based, and every row keeps both screenshots so
a person can overrule it:

| Class              | Rule                                                                |
| ------------------ | ------------------------------------------------------------------- |
| `regression`       | the candidate throws, or fails a step, where the base does not       |
| `restore-gap`      | the candidate hits a 404 on an `/api/` call the base does not        |
| `intended-restore` | the base has no such screen and the candidate renders one            |
| `noise`            | under 2% different with no errors on either side                     |
| `changed`          | a real difference none of the rules explains                         |

A failure rule beats a restore rule: a restored screen that throws is a
regression, not a restoration. `regression` and `restore-gap` are the rows
counted as findings, and they are what decides exit status 1.

## Adding a route

Add the path to `routes:` in `visualdiff.yaml`. `{slug}` is substituted with
the run's project slug.

## Adding a flow

Add an entry under `flows:` whose steps each name an action:

```yaml
- id: prompt-create
  title: Add a prompt and a version
  steps:
    - action: createPrompt
      with:
        message: You are the visual-diff assistant.
    - action: go
      with:
        path: /{slug}/prompts
```

The actions live in `runner/src/flows/`: primitives (`go`, `click`, `fill`,
`select`, `type`, `wait`, `dismissTour`) in `primitives.ts` and the named ones
(`signIn`, `createAutomation`, `createEvaluation`, `sendTrace`, `openTrace`,
`annotate`, `editProjectSettings`, `createPrompt`, `createExperiment`,
`createPairwise`, `createScenario`, `createRunSet`, `createDashboard`) in
`actions.ts`. To add one, write it there, register it in `registry.ts` and add
its name to `RunnerActions` in `config.go` — a unit test holds the two lists to
the same names, and the Go side refuses an unknown action before it checks out
a single worktree.

A named action takes its own snapshots with `context.snapshot("label")`, so a
wizard's every page is evidence rather than only its last.

## Why the settle is event-driven

The runner counts requests in flight and photographs a screen once the count
has sat at zero for the quiet window. Server-sent events, websockets and
Vite's hot-update traffic are not counted: an event stream stays open for the
life of the page, so counting it means never settling. A fixed sleep instead
either photographs a half-rendered page or wastes minutes across two hundred
routes.

## Layout

```text
tools/visualdiff/          the Go CLI: boot, wait, seed, classify, report, teardown
cmd/visualdiff/main.go     the entry point
tools/visualdiff/runner/   @langwatch/visual-diff-runner: Playwright capture + pixel diff
visualdiff.yaml            what gets rendered — the only file most changes touch
specs/tooling/visual-diff.feature
```

The two halves talk over JSON lines on the runner's stdout; anything a person
reads goes to its stderr, so the protocol never has to tell prose from data.

## Checks

```bash
go build ./cmd/visualdiff
go test ./tools/visualdiff/...
golangci-lint run ./tools/visualdiff/... ./cmd/visualdiff/...
pnpm --filter @langwatch/visual-diff-runner test:unit
```
