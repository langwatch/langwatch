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
               [-dry-run] [-keep] [-agent] [-no-haven]
```

Exit status is `0` for no findings, `1` for findings, `2` when the run could
not be completed — the same ladder as `apidiff`.

## What a run does

1. `git worktree add --detach` for each ref, into `.visualdiff/<timestamp>/`.
2. Brings each ref's worktree up as its own stack. Wherever `haven` is on
   PATH (the default - see "Booting through haven" below), each ref is a
   `haven up --agent --detach` stack under its own run-scoped slug, and
   haven's own automatic prep does the install, codegen, migrate and seed.
   With `-no-haven`, visualdiff provisions the old way instead:
   `pnpm install --offline` and `pnpm run start:prepare:files` in each
   worktree, then each ref's stack starts on its own ports - the base at
   `-base-port` (5670 by default), the candidate ten above it, so the two can
   never collide. A modular checkout runs `dev:ui`, `dev:api` and
   `dev:worker`; a monolith checkout runs `dev:app` with the Prisma,
   ClickHouse and provisioning steps skipped, because both refs share your
   local databases and the older ref must not re-apply its own migration set
   over them.
3. Polls both stacks until they answer, then seeds a handful of traces and one
   dataset through the **candidate's** API, so the fixtures exist in the shape
   the newer code writes.
4. Runs `@langwatch/visual-diff-runner` (Playwright) over both stacks: every
   route, then every flow, screenshotting as it goes and diffing each pair.
5. Writes `report.html`, `findings.md` and `findings.json` into the run
   directory.
6. Tears both stacks down. On the haven path: `haven destroy` for exactly the
   two slugs this run started, then both worktrees are removed. With
   `-no-haven`: both stacks are killed by process group through
   `dev/scripts/kill-dev-tree.sh`, the ports are verified free, and both
   worktrees are removed - on every exit path, including a failed boot,
   either way.

Start with `-dry-run`: it prints the plan and the flow list - the ports on
`-no-haven`, the two haven slugs otherwise - and starts nothing.

## Booting through haven

The previous port-based runner boots each ref on a hand-rolled environment
and fixed ports (5670/5680): a fresh worktree has no `.env` (it is
gitignored, and nothing copied one in), so its API crash-loops on missing
variables, and both refs land on whichever Postgres, ClickHouse and Redis the
developer's own shell environment points at. haven already solves exactly
this for a stack it supervises: its own database per slug, its own Redis
index, its own hostnames, and the resolved environment injected into every
process it starts.

So wherever `haven` is on PATH, `visualdiff run` boots each ref as a haven
stack under a run-scoped slug (`visualdiff-<run>-base`,
`visualdiff-<run>-candidate`) instead of provisioning ports and an
environment itself: `LANGWATCH_SLUG=<slug> haven up --agent --detach` in each
worktree, then poll `haven status --agent --json` until both the `ui` and the
`backend` lane are listening. The stack's URL is the routed `app.<slug>...`
hostname `haven status` reports - the origin the browser actually renders,
with the API served under `/api` on it, same as every other haven stack.
`-no-haven` keeps the port-based path from the previous section - pass it on
a machine without haven, or to reproduce the exact behaviour this replaced.

Unlike `apidiff` (`specs/tooling/apidiff-on-haven.feature`), this path is
**not** gated on layout: it runs `haven up` for whatever the checkout
defines and lets haven's own readiness answer decide, rather than refusing a
monolith (`platform/app`) ref up front. As of this writing that still means
only the modular layout actually becomes ready - haven's two Node lanes are
hardcoded to `pnpm --filter @langwatch/ui dev` and
`pnpm --filter @langwatch/dev-runtime dev` (`tools/thuishaven/app/plan.go`),
and neither package exists on the monolith checkout - but the failure is
haven's own, surfaced through the ordinary boot timeout and backend log tail,
not a bespoke refusal that would need updating the day haven learns to start
what a monolith checkout defines. See
`specs/tooling/visualdiff-on-haven.feature` for the bound scenarios.

`.githooks/post-checkout` (`git config core.hooksPath .githooks`) copies the
main checkout's untracked `.env*` files into a newly added worktree - but
only into the workspace root, `services/langevals`, `sdks/python`,
`sdks/typescript` and `mcp/typescript`, never into `platform/app`, which is
where the monolith's own `env-load.ts` reads its `.env` from. That gap is
orthogonal to this change (haven does not read a copied `.env` file for the
lanes it supervises either - it resolves secrets itself and injects them into
the processes it starts) but is worth knowing if you are chasing a monolith
ref's crash-loop on the port-based path.

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
tools/visualdiff/haven.go  the haven boot path: slugs, up, readiness, teardown
tools/havenrun/            what visualdiff and apidiff share to boot through haven
cmd/visualdiff/main.go     the entry point
tools/visualdiff/runner/   @langwatch/visual-diff-runner: Playwright capture + pixel diff
visualdiff.yaml            what gets rendered — the only file most changes touch
specs/tooling/visual-diff.feature
specs/tooling/visualdiff-on-haven.feature
```

The two halves talk over JSON lines on the runner's stdout; anything a person
reads goes to its stderr, so the protocol never has to tell prose from data.

## Checks

```bash
go build ./cmd/visualdiff
go test ./tools/visualdiff/... ./tools/havenrun/...
golangci-lint run ./tools/visualdiff/... ./cmd/visualdiff/... ./tools/havenrun/...
pnpm --filter @langwatch/visual-diff-runner test:unit
```

No `Makefile` target names `visualdiff`, `5670` or `5680` - the ports the
`-no-haven` path uses are only ever derived at runtime from `-base-port`, so
there is nothing in the `Makefile` for this change to update.
