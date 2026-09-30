# diffsuite

Runs the diff tools (apidiff, visualdiff, fuzz) together against one set of
stacks it owns, and stops them all when one stopping is a sign the rest are
wasting time.

```bash
go build -o .bin/diffsuite/diffsuite ./cmd/diffsuite
.bin/diffsuite/diffsuite -stack visualdiff-check -out .claude/tmp/runs/x
.bin/diffsuite/diffsuite -up -main -out .claude/tmp/runs/y -- fuzzapi+='-duration 5m'
```

## The stacks

No tool boots a stack of its own under diffsuite; diffsuite chooses them once and
every tool shares them.

- **Branch:** `-stack <slug>` adopts a running haven stack (default `visualdiff-check`);
  `-up` starts `diffsuite-<time>-branch` from this checkout and waits until both lanes listen;
  `-up -langevals` starts it with `haven up +langevals`, so monitors and evaluations have an evaluator.
- **Main (optional):** `-main-stack <slug>` adopts a running one; `-main` starts
  `diffsuite-<time>-main` at visualdiff's pinned main (`.visualdiff/baselines/main-pin.json`),
  booted as a visualdiff run boots its base. With neither, tools compare with main's
  baselines (visualdiff) or run single-sided (apidiff).
- A stack diffsuite started is destroyed when the suite ends, on a failed start and on
  Ctrl-C or SIGTERM (the tools are stopped first). A passed-in stack is never touched.
- `-health` defaults to the branch stack's `/api/health`.

## The self-hosted pass

The stacks run as SaaS (the root `.env` sets `IS_SAAS`), which hides the instance-admin
routes, so apidiff defers the scenarios needing the admin key and lists them in
`<out>/apidiff/deferred.txt`. `-deployment self-hosted` runs them:

```bash
.bin/diffsuite/diffsuite -deployment self-hosted -up -deferred .claude/tmp/runs/x/apidiff/deferred.txt -out .claude/tmp/runs/x-sh
IS_SAAS=false LANGWATCH_SLUG=visualdiff-selfhosted haven up --agent --detach   # a long-lived one to adopt
.bin/diffsuite/diffsuite -deployment self-hosted -deferred <file> -out <dir>   # adopts visualdiff-selfhosted
```

- `-up` starts `diffsuite-<time>-selfhosted` with `IS_SAAS=false` in `haven up`'s environment,
  for that slug only. haven has no per-slug overlay, but the process environment beats the root
  `.env` (`node --env-file` and vite's dotenv never override it), and `.env` is never edited.
  It is not sticky: a later plain `haven up` of the same slug comes back as SaaS.
- Without `-up` it adopts `-stack`, default `visualdiff-selfhosted`. A stack whose
  `GET /api/organizations` answers 404 (SaaS, or no admin key) is refused.
- haven mints each stack's instance-admin key and apidiff takes it from `haven env`; the
  storage seed signs the dev licence from secrets. Neither needs a flag.
- `-deferred <file>` appends `-scenario-id @<file>` to api. `-tools` defaults to `api`: visualdiff
  flows carry no deployment tag (its `-edition` is the licence), so there are no self-hosted flows
  to pick; the instance-admin screens are noted in `flows/admin-security.yaml`.
- `-main` is refused (pinned main boots as SaaS); a self-hosted main can be named with `-main-stack`.

## Telling the tools

Every tool gets its stacks in its environment, and reads them when no flag names one:

| variable | value |
|---|---|
| `DIFFSUITE_BRANCH_STACK`, `DIFFSUITE_MAIN_STACK` | the haven slug |
| `DIFFSUITE_BRANCH_URL`, `DIFFSUITE_MAIN_URL` | the app origin |
| `DIFFSUITE_BRANCH_API_URL`, `DIFFSUITE_MAIN_API_URL` | where `/api` answers without the proxy (the backend's loopback port, or the app origin on a monolith) |
| `DIFFSUITE_BRANCH_MAIL_URL`, `DIFFSUITE_MAIN_MAIL_URL` | the mail sink |
| `DIFFSUITE_OUT` | the suite's `-out`, absolute |

The `MAIN` ones are set only when there is a main stack (`diffkit.SuiteEnv`, `diffkit.SuiteStack`).

- **apidiff scenarios:** `-a` (and `-mail-a`) from the branch, `-b` (and `-mail-b`) from main.
- **visualdiff check:** adopts the branch stack as `-shared` without ever booting it
  (a stack that is not up is a setup failure), and compares with main's stack when there is
  one, else with the pinned baseline. `visualdiff run` refuses under diffsuite: it boots its own.
- **fuzz api|ui:** the branch stack, and its log for the log oracle.

## The default suite

With no `name=` after `--`, `-tools` (default `api,visual,fuzzapi,fuzzui`) picks from:

| name | command |
|---|---|
| api | `apidiff scenarios -scenario-concurrency 16 -final -run-dir "$DIFFSUITE_OUT/apidiff"` |
| visual | `visualdiff check -routes -all` (every flow and route) |
| fuzzapi | `fuzz api -duration 20m` |
| fuzzui | `fuzz ui -duration 20m -workers 3 -actions 10` |

Each runs `.bin/<tool>/<tool>`, built with `go build` before the suite starts. After `--`,
`name+='<flags>'` appends flags to a tool in the suite, and `name='<command>'` replaces one
or adds another (run from the repository root, with the environment above).

## Running and stopping

- Each tool runs as `bash -c '<command>'` in its own process group, all at once. Output goes to
  `<out>/<name>.log`; `<out>/events.log` gets the FAIL/ERROR/tally/panic/fatal lines as `[name] ...`,
  `[name] EXIT <code>` per tool and `all runs ended: ...` last; `<out>/summary.json` has each tool's
  exit, stop reason and cause, duration and the verdict.
- **stdout is the live view** (plain text, no ANSI, so `> r.log` and grep work): every 15 s one
  `[name] RUNNING <elapsed> load <1m 5m 15m>: <latest>` line per running tool, where latest is the last
  line matching the tool's progress pattern (api `N run`, visual `flows passed`/`step`, fuzz `visits ... routes`),
  else its last line; every events.log line as it happens; `[name] EXIT <code>`; and at the end a table of
  tool, exit, duration and the tool's last tally line. Load is `uptime`'s load average.
- **Results stream as they appear**, prefixed `[name]`: apidiff `FAIL*`/`ERROR` lines and their
  `first failing step`, visualdiff `FAIL`/`UNPROVEN`/`ROUTE` lines, and each new distinct fuzz finding
  (`FINDING #<n> <oracle> <route> status <code>: <message>`, once per signature, so `#<n>` is the running
  distinct count). Fuzz findings are tailed from the `findings.jsonl` in the directory the tool's
  `wrote <path>` line names. `fuzz ui` names it at start; apidiff prints its failure report and
  `fuzz api` writes its findings only when the run ends, so those two stream then, not during.
- A tool's `stopping: <reason>` line prints at once as `[name] STOPPED (<cause>): <reason>`.
- **The end-of-run report** follows the table: per tool `pass`, `fail`, `error` and `distinct findings`,
  then failing ids and distinct findings grouped by module or route family, at most 50 lines a tool,
  the rest as `N more ... in <file>`.
- A tool exiting 3 has stopped (`diffkit.ExitStopped`). The reason is the text after the last `stopping: `
  in its output, and it is put in one cause class: sign-in, stack-unreachable, browser-closed, timeout, other.
- `-policy`: `half` (default) cancels the rest when half the tools have stopped, or two stopped with the same
  non-`other` cause; `same-cause` only the second rule; `any` on the first stop; `none` never.
- Cancel is SIGTERM to each group, SIGKILL after 20 s, logged as `diffsuite: stopping all: <reason>`
  (`cancelled` on Ctrl-C).
- The health URL must answer 2xx to start, is polled every 30 s, and three failures in a row stop all
  ("stack unhealthy").
- Exit: 0 all passed; 2 could not start; 3 stopped by policy, health or cancel; else the highest tool exit code.

## Publishing to the pull request

```bash
.bin/diffsuite/diffsuite publish -out .claude/tmp/runs/x -pr 7536 -dry-run   # prints the new body
.bin/diffsuite/diffsuite publish -out .claude/tmp/runs/x -pr 7536            # patches it
```

`publish` renders one suite run into the PR body between `<!-- parity-status:start -->` and
`<!-- parity-status:end -->`, and rewrites only what the tools decide:

- the lines before the first `### ` heading: the header (time, commit, stack, what main is) and the
  one-line verdict;
- the first table under `### Coverage by area`: one row per area, red first. Green: every API
  scenario passes and the UI is proven; orange: 90% or more pass, or the UI is not proven; red:
  below that, or untested. The API column comes from apidiff's `scenarios.jsonl`, grouped by route
  family (the first path segment after `/api`, past `v1`, `latest` and a dated version;
  `areaFamilies` in `publish_read.go`); the UI column from visualdiff check's per-flow verdicts,
  by flow file (`flowFileAreas`), else it keeps the hand text;
- the first table under `### Open defects`: failures grouped by area, with counts and example ids;
  "what's wrong" and "status" are kept per area from the table it replaces;
- the first table under `### Test runs`: one row per tool, this run, the run before and whether it is
  usable. Usable is mechanical: apidiff with fewer than 10% tool errors; visualdiff that ran a flow;
  fuzz api unless most findings are proxy 502s; fuzz ui unless it visited no route or most findings
  are pages that never loaded; never a tool that stopped or was killed.

A missing machine heading is added in order; every other line in the section (Found in review, Next,
the `<details>` blocks) is hand-kept and left as it is. The view carries no run ids.

"Run before" is what the last publish showed, kept in `published.json` beside the suite directory
(`.claude/tmp/runs/published.json`); publishing the same run again keeps its "run before". Without
`-dry-run`, the UI row links visualdiff's one `visualdiff:screens` comment, which `visualdiff publish`
updates from `.visualdiff/check`, and which is withdrawn when the UI run is not usable. The body is
written with `gh api .../pulls/<N> -X PATCH -f body=...`.
