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
               [-viewport 1440x900] [-config PATH] [-root DIR]
               [-base-port N] [-run-dir DIR] [-boot-timeout DUR]
               [-dry-run] [-keep] [-agent] [-no-haven]
```

Exit status is `0` for no findings, `1` for findings, `2` when the run could
not be completed — the same ladder as `apidiff`.

## What a run does

1. `git worktree add --detach` for each ref, into `.visualdiff/<timestamp>/`.
2. Brings each ref's worktree up as its own stack. Wherever `haven` is on
   PATH (the default - see "Booting through haven" below), each ref's fresh
   worktree is prepared first - install, generated files, the built
   workspace packages the api and worker import a dist from, and the
   developer's own `.env` copied in (see "Preparing a fresh worktree" below)
   - and only then does it become a `haven up --agent --detach` stack under
   its own run-scoped slug, with haven's own automatic prep doing migrate and
   seed. With `-no-haven`, visualdiff provisions the old way instead:
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
   route, then every flow, screenshotting as it goes and diffing each pair -
   appending one line to `findings.jsonl` as each screen's comparison is
   decided (see "Findings stream and recapture" below), not only at the end.
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

## Preparing a fresh worktree

haven's own automatic prep is migrate-and-seed, not install-and-build. A
worktree `git worktree add` just created carries none of the generated or
built artefacts a developer's own checkout has - `node_modules`, the Prisma
client, the `langwatch` SDK's `dist` - because they are all gitignored, so
`haven up` there used to fail in its own prepare phase before it ever reached
migrate. Run 20260910-013825 is the record of it: the base died on
`Error: Cannot find module '~/generated/prisma/client'`, the candidate on
`Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../langwatch/dist/index.mjs'`,
both then `haven: migrations failed - nothing was dropped`.

So before either worktree becomes a haven stack, `checkoutForHaven` runs, per
stack:

1. Copies the developer's own untracked `.env*` files from the workspace
   root into the worktree - the same job `.githooks/post-checkout` does for a
   worktree added by hand, without depending on a machine having opted into
   `core.hooksPath` (`CopyEnvFiles` in `haven.go`). A tracked file
   (`.env.example`) is left alone. First, because the next step's
   `prisma generate` reads `DATABASE_URL` out of the schema's `env()` call at
   generate time.
2. `env -u CI pnpm install --frozen-lockfile` - pnpm's workspace symlinks are
   per worktree, so a developer's own `node_modules` is no help here. `CI` is
   unset so `dev/scripts/install-check-shims.mjs` and friends behave as they
   do for a person, not for a pipeline.
3. `pnpm run start:prepare:files` - the generated files (Prisma client,
   evaluator types, the langy skill/setup generators). The same command on
   both refs: the script name is identical in both layouts' root
   `package.json`, and each ref's own version resolves to what that ref
   actually needs.
4. Modular layout only: `node dev/scripts/ensure-built.mjs`, building the
   workspace packages the api and worker import a built `dist` from
   (`langwatch`, `@langwatch/mcp-server`, `@langwatch/mail` - see that
   script and the three applications' `predev`/`pretest` hooks). The
   monolith layout's own `start:prepare:files` (`platform/app`'s, on
   `origin/main`) already builds the SDK and the MCP server inline, and
   `ensure-built.mjs` does not exist there at all.

Every step's name and exit status go to the run log as it runs; nothing here
ever logs a byte of `.env`'s contents. See
`specs/tooling/visualdiff-on-haven.feature`'s "A fresh worktree is prepared
before its stack boots" rule for the bound scenarios.

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

## Findings stream and recapture

`report.html`, `findings.json` and `findings.md` are written once, after the
whole capture finishes - fine for reading the result, useless for watching a
long run while it is still going. Every `run` and every `recapture` also
appends to `<run-dir>/findings.jsonl`: one JSON line the instant a screen's
comparison is decided, fsynced before the run continues, so `tail -f
<run-dir>/findings.jsonl` shows a finding as soon as it exists. Each line is:

```json
{"route":"/{slug}/analytics","kind":"changed","module":"analytics","evidence":{"base":"shots/base/routes/analytics.png","candidate":"shots/candidate/routes/analytics.png","diff":"shots/diff/route_%7Bslug%7D_analytics_0.png"},"message":"differs by 4.10%","capturedAt":"2026-09-10T03:05:00Z"}
```

`kind` is one of `missing-on-candidate`, `changed`, `console-error`,
`capture-failed`, `identical` - narrower than the report's own
`Classification` above, because this is a live triage feed rather than the
rule-based report. A flow's lines carry `flow` and `index` instead of
`route`. `module` is a best-effort guess at the owning module, from
`apps/ui/src/features/catalogue.json`'s feature `root` segments (matched
against the route's first path segment or the flow id's leading word, plural
tried too); empty when nothing matches. `evidence` paths are relative to the
run root. The last line of a run (or a recapture) is always
`{"kind":"run-complete","total":N,"counts":{...},"capturedAt":"..."}`.

Most kinds are decided, and written, the moment enough is known - a failed
capture or a new console error need only one or two capture messages, a pixel
diff needs the diff message too - all of which the runner streams off its
stdout as it works (`RunRunner` pipes it live, not buffered until the process
exits). `missing-on-candidate` is the one exception: nothing says "no more
messages are coming for this route", so it can only be decided once the whole
capture step ends, in the same pass that writes `run-complete`. One
consequence of the runner's own two-full-passes order (base side captured
completely, then candidate) is that today's runner still computes every pixel
diff in one batch right before it reports "done" - so `changed`/`identical`
lines arrive as a fast burst near the end of a run rather than spread across
its whole duration, even though `capture-failed`/`console-error` lines do
arrive throughout. Spreading diffs out too would mean interleaving the two
sides' capture passes in `tools/visualdiff/runner/src/main.ts`, which is a
bigger change to that package's execution model than this one made.

A triage loop fixes one thing, then wants to know if it worked, without
re-booting both stacks:

```bash
go run ./cmd/visualdiff run -keep -agent    # stacks stay up when the run ends
# ...fix something in the candidate checkout...
go run ./cmd/visualdiff recapture -run 20260910-030000 -routes /{slug}/analytics,/{slug}/settings
# ...repeat recapture as many times as needed...
haven destroy visualdiff-20260910-030000-base visualdiff-20260910-030000-candidate   # when done
```

`recapture` reads the run's own persisted plan
(`<run-dir>/shots/plan.json` - written by the capture step, so it always
carries the two stacks' actual URLs) rather than re-deriving anything, drives
only the named routes against those same two stacks, and appends to the same
`findings.jsonl`. It never checks out a worktree, never runs `haven up`, and
never tears anything down - both are the `run` step's job, not
`recapture`'s. See `specs/tooling/visualdiff-on-haven.feature`'s "A findings
stream reports each comparison as it completes" rule for the bound scenarios.

## Adding a route

Add the path to `routes:` in `tools/visualdiff/visualdiff.yaml`. `{slug}` is substituted with
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
tools/visualdiff/                    the Go CLI: boot, wait, seed, classify, report, teardown
tools/visualdiff/haven.go            the haven boot path: slugs, up, readiness, teardown, worktree prepare
tools/visualdiff/findings_stream.go  findings.jsonl: the live tracker, the file writer, run+recapture's shared capture path
tools/visualdiff/catalogue.go        the module guess, from apps/ui/src/features/catalogue.json
tools/visualdiff/recapture.go        `visualdiff recapture`: replays named routes against a -keep run's own stacks
tools/havenrun/                      what visualdiff and apidiff share to boot through haven
cmd/visualdiff/main.go               the entry point
tools/visualdiff/runner/             @langwatch/visual-diff-runner: Playwright capture + pixel diff
tools/visualdiff/visualdiff.yaml     what gets rendered - the only file most changes touch
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
