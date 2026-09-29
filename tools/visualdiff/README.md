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
               [-editions enterprise,free] [-no-baseline] [-refresh-baseline]
               [-no-fail-fast] [-resume RUNID]
visualdiff recapture -run RUNID [-routes a,b] [-flows x,y] [-edition E]
visualdiff coverage [-base REF] [-candidate REF] [-config PATH]
visualdiff gc [-kept] [-no-haven]
visualdiff publish -run-dir DIR [-pr N] [-link URL] [-base REF] [-candidate REF]
```

Read `<run-dir>/summary.txt` first (a run also prints it; `-agent` leads it
with a `rows= findings= reports=` line): counts per class and edition, the
coverage verdict, the worst 20 findings one line each with the candidate's
final path, its new failed API requests and its role diff, and every
uncovered route. Everything the run wrote to stderr is in
`<run-dir>/run.log`. The candidate renders the ref's last commit: a run warns
when the candidate is `HEAD` and tracked files have uncommitted changes.

Exit status is `0` for no findings, `1` for findings, `2` when the run could
not be completed — the same ladder as `apidiff`.

A run compares rendering only. No findings means both refs drew each screen
alike, not that the screens work: nothing is exercised past the configured
flows. summary.txt, findings.md, report.html and the PR comment all say so.

## What a run does

1. Checks each ref out. On the haven path each side has one persistent
   worktree, `.visualdiff/worktrees/{base,candidate}`, moved to the ref's
   commit in place (`git checkout --detach --force`), so `node_modules`,
   generated files, built dists and Vite's cache stay warm between runs; a
   worktree another live or `-keep` run holds is not shared, and that run
   gets `.visualdiff/<timestamp>/<side>` of its own. With `-no-haven`,
   `git worktree add --detach` into `.visualdiff/<timestamp>/`.
2. Brings each ref's worktree up as its own stack. Wherever `haven` is on
   PATH (the default - see "Booting through haven" below), each worktree is
   prepared first - install, generated files, the built workspace packages
   the api and worker import a dist from (a monolith runs only the install
   and `prisma generate`: haven's own `dev:app` builds the rest), and the
   developer's own `.env` copied in (see "Preparing a fresh worktree" below).
   A persistent worktree skips the install and generated files when its
   commit's tree matches the last prepare that finished
   (`.visualdiff/worktrees/<side>.prepared`) - and only then does it become a `haven up --agent --detach` stack under
   its own run-scoped slug, with haven's own automatic prep doing migrate and
   seed. Each side goes up the moment its own prepare finishes, so the base,
   the slower boot, migrates while the candidate still prepares. While a
   stack boots its UI is built for production (see "Capturing a built UI"). With `-no-haven`, visualdiff provisions the old way instead:
   `pnpm install --prefer-offline` and `pnpm run start:prepare:files` in each
   worktree, then each ref's stack starts on its own ports - the base at
   `-base-port` (5670 by default), the candidate ten above it, so the two can
   never collide. A modular checkout runs `dev:ui`, `dev:api` and
   `dev:worker`; a monolith checkout runs `dev:app` with the Prisma,
   ClickHouse and provisioning steps skipped, because both refs share your
   local databases and the older ref must not re-apply its own migration set
   over them.
3. Polls both stacks until they answer, then seeds each through its own API.
   On haven, when both sides boot live and the first edition is the seeded
   one, the candidate is captured as soon as it is up: the base boots and
   seeds meanwhile, and reaches the runner through `base-side.json`.
4. Runs `@langwatch/visual-diff-runner` (Playwright) over both stacks: every
   route across the larger of `concurrency.routes` and `concurrency.flows`
   pages of one signed-in session. A page takes a read-only flow once no route
   is left for it; flows that create things wait for every route, then use
   every page; a flow that filters a view, then one that edits the project,
   run last, alone. It screenshots as it goes and diffs each pair on worker
   threads -
   appending one line to `findings.jsonl` as each screen's comparison is
   decided (see "Findings stream and recapture" below), not only at the end.
5. Writes `report.html`, `findings.md` and `findings.json` into the run
   directory.
6. Tears both stacks down. On the haven path: `haven destroy` for exactly the
   two slugs this run started, detached into `teardown.log` so the run exits
   at once; a run-scoped worktree is removed after its destroy. With
   `-no-haven`: both stacks are killed by process group through
   `dev/scripts/kill-dev-tree.sh`, the ports are verified free, and both
   worktrees are removed - on every exit path, including a failed boot,
   either way.

Start with `-dry-run`: it prints the plan and the flow list - the ports on
`-no-haven`, the two haven slugs otherwise - and, per edition, whether the
base will be replayed from a baseline or rendered live. It starts nothing.

## Baselines, editions and failing fast

**Baselines.** Booting the base is most of a run's cost, and the base does
not move while you fix your branch. Each live base pass is cached under
`.visualdiff/baselines/<commit>-<edition>-<hash>/` (captures plus
screenshots). The hash covers what changes a capture: the viewport, the
settle and fixtures configuration and the runner sources that capture,
settle and diff (`captureSources` in baseline.go). Its `meta.json` lists the
routes and flow steps it recorded; a plan it does not cover renders the base
live and replaces it. A run whose
every edition has a baseline never checks out or boots the base at all: only
the candidate stack comes up. `-refresh-baseline` re-renders and replaces
it; `-no-baseline` neither reads nor writes one.

**Editions.** Both refs seed the same signed local-dev enterprise licence onto
`Organization.license` for `local-dev-organization`, and a null licence
resolves to the open-source plan on both. A run captures the `enterprise`
pass on the seeded licence; `-editions enterprise,free` adds a `free` pass
on the same stacks with the licence cleared (`psql` against `haven db
url`), at twice the capture time. Each pass has its own `shots/<edition>/`,
`report/<edition>/` and edition-tagged `findings.jsonl` lines. `-no-haven`
shares your own database, so it refuses `free`.

**Signed in.** The runner signs in as the seeded admin
(`admin@haven.localhost`) before the first route and renders
`{slug}` as `local-dev-project`; `-email`, `-password` and `-slug`
override it.

**Failing fast.** The candidate is captured before the base, and each screen is
diffed as soon as both sides exist. If the candidate's first three routes each
throw, raise a page error or render blank, the run stops right away with the
reason for each one (`-no-fail-fast` carries on anyway). Run with `-keep`,
fix, then `recapture` the routes or flows that failed: it replays the base
from the same baseline.

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
defines. haven boots a monolith (`platform/app`) checkout too - its single
app lane replaces the ui and backend lanes (`tools/thuishaven/app/plan.go`,
`plan_monolith.go`) - and a monolith stack is ready when that app lane is.
See `specs/tooling/visualdiff-on-haven.feature` for the bound scenarios.

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

One classifier (`classify.go`) decides every screen, for the report,
`findings.jsonl` and `summary.txt` alike. Rules run in this order; the first
that applies wins, and every row keeps both screenshots so a person can
overrule it. The finding classes fail the run (exit 1):

| Class               | Rule                                                                            |
| ------------------- | ------------------------------------------------------------------------------- |
| `missing-candidate` | the base captured the screen and the candidate never did                        |
| `missing-base`      | the candidate captured the screen and the base never did - nothing compared     |
| `capture-failed`    | a side's own modules did not load, even taken again alone - the tool's failure  |
| `broken-both`       | the route or flow step fails on both refs                                       |
| `regression`        | the candidate fails, or logs a console error, where the base does not           |
| `not-found`         | the candidate shows its not-found page where the base renders the screen        |
| `blank`             | the candidate page has no text at all, on any route or step                     |
| `redirect`          | the candidate ends on a different path (ids masked) than the base               |
| `api-error`         | a 4xx, 5xx or failed `/api/` or tRPC request the base does not make             |
| `layout`            | the page changed size, 5% or more of its covered area moved, or pixels differ by 10% or more |
| `controls`          | a button, link, heading, tab or form field one side has and the other lacks     |
| `uncovered`         | a route either ref declares that `visualdiff.yaml` neither renders nor excludes |

The informational classes are reported and never fail it:

| Class              | Rule                                                                 |
| ------------------ | -------------------------------------------------------------------- |
| `intended-restore` | the base has no such screen, or fails, and the candidate renders one |
| `copy`             | the same controls with different words, in the same layout           |
| `changed`          | a pixel difference over 2% none of the rules explains                |
| `noise`            | under 2% different with nothing else wrong                           |

Layout runs before the text rules, so a collapsed pane is never read as
`copy` or `controls`. The covered area is every pixel more than one level
from the page's dominant colour, compared in 16px blocks; a block moved when
over 32 of its pixels changed coverage (`layout.go`). It catches what the
pixel diff's threshold misses under a blurred dialog, and a new background
tint moves no blocks.

Text evidence comes from each screen's accessibility tree
(`page.locator("body").ariaSnapshot()`), compared with dates, times,
relative times, ids and digits masked. Pages see one frozen `Date.now()`
per pass, and `<time>` elements and relative times are masked in the
pixels too.

## Coverage

Every route either ref declares is rendered by a `routes` entry, excluded
under `coverage.excluded` with a reason, or reported `uncovered` - a
finding. The base's routes are its pages directory (`coverage.basePages`,
main's Next.js pages); the candidate's are its `"pages/..."` screen keys in
`*.web.ts(x)`, or the `path:` a screen declares under its key. Both are read
from git, so `visualdiff coverage` answers in a second without booting
anything. A route's `{name}` placeholder is filled from `fixtures`, the ids
the run seeds deterministically (the traces, today); dynamic routes with no
seeded entity stay uncovered, loudly. Configured routes neither ref declares
are listed as stale.

## Publishing to the pull request

A finished run shows its screens on the open pull request of the checked-out
branch (`gh pr list --head <branch>`), in one comment marked
`<!-- visualdiff:screens -->` that each run edits in place: gh uploads images
only by posting, so the run posts the comment with `gh pr comment --attach`,
copies the posted body (its images now uploaded assets) over the marked
comment, and deletes the post. The comment carries the run id, both commits,
the counts by class and up to `publish.screens` screens: every
`publish.keyPages` page first, then the findings and then the other changes,
largest first, one screen per area (project, traces, analytics, settings,
governance, ops, me, auth, ...) before any area repeats. A blank, failed or
`capture-failed` capture is never shown. The base is shown
beside the candidate only where it is readable. Each image is scaled to
`publish.width` and cut at `publish.maxHeight`. A screen whose text on either
side looks like a key, a token or a local file path is never published.
`-no-publish` skips it, and so does a branch with no open PR or a gh that is
not signed in; a failed publish never changes the run's exit code.
`visualdiff publish -run-dir DIR` publishes a finished run afterwards, from
its `report/*/findings.json`: `-pr` names the pull request and `-link` adds
the full report's address. It exits 0 when it published, 1 when it skipped
and said why, 2 when it failed.

## Running in CI

`.github/workflows/visualdiff.yml` runs on every non-draft pull request that
touches the application, and on `workflow_dispatch`. One run per PR: a newer
push cancels the one still going. It follows `apidiff.yml` and `e2e-ci.yml`:

1. Postgres, ClickHouse and Redis are job services; the secrets are throwaway
   values in the job's environment. Nothing needs a repository secret.
2. The candidate's own migrations and seed run against them from the checkout
   (`pnpm prisma:migrate`, `pnpm clickhouse:migrate`, `pnpm prisma:seed`):
   the state a developer's database is in before a `-no-haven` run. The base
   then boots on the candidate's schema with its migrations skipped, the same
   as every rolling deploy's old release does.
3. `visualdiff run -no-haven -no-publish -no-baseline` boots both refs on
   plain ports from worktrees under the runner's temp directory, captures the
   enterprise edition and writes the report. The Playwright browser is cached
   by version.
4. The run directory's report, screenshots and logs upload as the
   `visualdiff-report` artifact (7 days): `report/<edition>/report.html`
   addresses its screenshots relative to itself, so it opens from the
   download. `summary.txt` becomes the job summary.
5. `visualdiff publish -pr <n> -link <artifact>` edits the PR's one marked
   comment. When no screen went up (the run broke, nothing was selected, or
   gh could not attach images with the workflow's token) the workflow writes
   the run's status into the same marked comment instead. A fork's PR has a
   read-only token: it gets the job summary and the artifact, no comment.

Findings are for review and never fail the job; exit 2 does, and prints the
end of every stack log into the step's output.

## Capturing under concurrency

A cold Vite dev server fed four pages at once drops module requests
(`net::ERR_HTTP2_PROTOCOL_ERROR`, `ERR_CONNECTION_CLOSED` on `/@fs/...`), and
the page renders white. So each side captures its first three routes one at a
time (the fail-fast probe, and the warm-up that compiles the shell's module
graph), then the rest across its pages. A capture that comes back blank, or
whose own module requests failed, is held back and taken again alone once the
pool is done; only that retake is kept. A capture whose modules still did not
load is `capture-failed`, never `blank`, and a live base holding one is not
cached as a baseline.

## Capturing a built UI

Each live side is captured from a production build of its own UI, not from its
Vite dev server: `apps/ui`'s `build` on a modular tree, `platform/app`'s
`build:client` on main's monolith, run while the stack boots and cached per
tree on a persistent worktree (`.visualdiff/worktrees/<side>.uibuilt`). The
runner answers every document the side opens with the built shell, carrying
the public config the dev server would have injected, and every file the
build holds from memory on the page's own origin; `/api` still reaches the
stack. A side whose build
fails is captured from its dev server, the run log says so, and such a base is
never cached. `-dev-ui` keeps both sides on their dev servers. Dev-only chrome
(the DEV badge) is absent on both sides alike.

## Cleaning up

Every run first collects what dead runs left behind (`visualdiff gc` does
the same on its own): a run directory whose `pid` names no live process
loses its haven stacks (and with them their databases), its own worktrees
(never the persistent `.visualdiff/worktrees`) and,
except for the newest one whose report may still be open, its directory.
Registered `visualdiff-*` stacks no run owns are destroyed, then `git
worktree prune` runs. A `-keep` run is left alone unless `gc -kept`.

## Findings stream and recapture

`report.html`, `findings.json` and `findings.md` are written once, after the
whole capture finishes - fine for reading the result, useless for watching a
long run while it is still going. Every `run` and every `recapture` also
appends to `<run-dir>/findings.jsonl`: one JSON line the instant a screen's
comparison is decided, fsynced before the run continues, so `tail -f
<run-dir>/findings.jsonl` shows a finding as soon as it exists. Each line is:

```json
{
  "route": "/{slug}/analytics",
  "kind": "changed",
  "module": "analytics",
  "evidence": {
    "base": "shots/base/routes/analytics.png",
    "candidate": "shots/candidate/routes/analytics.png",
    "diff": "shots/diff/route_%7Bslug%7D_analytics_0.png"
  },
  "message": "differs by 4.10%",
  "capturedAt": "2026-09-10T03:05:00Z"
}
```

Each line also carries `edition`, `finding` (whether the class fails the
run) and text evidence (`evidence.url`, `evidence.requests`,
`evidence.controls`). `kind` is a class from the table above. A flow's lines carry `flow` and `index` instead of
`route`. `module` is a best-effort guess at the owning module, from
`modules/catalogue.json`'s module ids and subjects (matched against the
route's first path segment or the flow id's leading word, singular tried
too); empty when nothing matches. `evidence` paths are relative to the
run root. The last line of a run (or a recapture) is always
`{"kind":"run-complete","total":N,"counts":{...},"capturedAt":"..."}`.

Most kinds are decided, and written, the moment enough is known - a failed
capture or a new console error need only one or two capture messages, a pixel
diff needs the diff message too - all of which the runner streams off its
stdout as it works (`RunRunner` pipes it live, not buffered until the process
exits). A screen missing on one side is the one exception: nothing says "no more
messages are coming for this route", so it can only be decided once the whole
capture step ends, in the same pass that writes `run-complete`.
`uncovered` lines are appended once every edition has run. Pixel diffs
stream too: the runner diffs each screen the moment its second side exists
(`runner/src/pairing.ts`), so on a replayed baseline every
`changed`/`noise` line lands as the candidate captures that screen.

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

The runner holds the requests themselves, not a count. A main-frame navigation
forgets the previous document's requests, and a request older than three
seconds is treated as a poll (the skeleton wait still guards a late screen), so one request that never reports back can no
longer hold every later capture to the deadline (run 10 lost an hour to it).
A settle that reaches its deadline logs the requests still in flight with
their ages, and each of them, once it ends, logs a `late` line splitting its
time into queued, server and body from the browser's own timing. A
side whose first five routes all reach it prints one loud warning. Telemetry
(`/api/rum/v1/traces`) is ignored, and the join offer's 429 is noise: its
allowance is a product constant a run's page loads exceed. Main raises the
passkey offer on every screen, so every capture declines it before its
screenshot; sign-in photographs it once as the `sign-in` flow.

## Layout

```text
tools/visualdiff/                    the Go CLI: boot, wait, seed, classify, report, teardown
tools/visualdiff/haven.go            the haven boot path: slugs, up, readiness, teardown, worktree prepare
tools/visualdiff/findings_stream.go  findings.jsonl: the live tracker, the file writer, run+recapture's shared capture path
tools/visualdiff/catalogue.go        the module guess, from modules/catalogue.json
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
pnpm --filter @langwatch/visual-diff-runner test
```

No `Makefile` target names `visualdiff`, `5670` or `5680` - the ports the
`-no-haven` path uses are only ever derived at runtime from `-base-port`, so
there is nothing in the `Makefile` for this change to update.
