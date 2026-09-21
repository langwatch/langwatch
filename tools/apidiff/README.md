# apidiff

`apidiff` compares the live behavior of two LangWatch API instances. It
fetches each instance's served OpenAPI document (`GET /api/openapi.json`),
reports spec-level changes (via `openapidiff`), then probes the union of
documented operations on both instances in lockstep — every probe case runs on
the candidate first and immediately after on the base, keeping both databases
in the same state — and reports behavioral differences: status codes,
response shapes, validation envelopes, and mutation outcomes. Volatile values
(ids, timestamps, secrets) are masked before comparison, so per-instance
state never produces false diffs.

```text
apidiff run   [-main-ref REF] [-branch-dir DIR] [-work-root DIR]
              [-keep] [-reuse-worktrees] [-skip-install] [-boot-timeout DUR]
              [-dry-run] [-no-haven] [-pg-url URL -ch-url URL -redis-url URL]
              [-compose-project NAME] [probe flags...]

apidiff probe -a URL -b URL [-project-key KEY] [-org-key KEY] [-admin-key KEY]
              [-scim-key KEY] [-project-key-b KEY] [-project-key-c KEY]
              [-timeout DUR] [-settle-timeout DUR] [-path-prefix P]
              [-method M] [-exact-status] [-exclude-prefix P]... [-max-ops N]
              [-json] [-report FILE] [-ledger FILE] [-ledger-baseline FILE]
```

`run` boots both instances itself — a detached git worktree for `-main-ref`
(default `main`), and, wherever haven is selected, a second worktree checking
out `-branch-dir`'s own HEAD — with isolated Postgres/ClickHouse databases
(run-scoped: `apidiff_<runid>_branch` / `apidiff_<runid>_main`, where the run
id derives from the work-root name) and Redis logical DBs (14/15), migrates
and seeds each, waits for health, probes, and tears everything down. `probe`
compares two already-running instances.

**Neither haven stack ever boots inside the invoking checkout.** haven
registers one stack per directory: booting the branch instance in place used
to let `haven up` there replace a developer's own stack registration for that
directory, and the run's teardown `haven destroy` take it down with it (an
incident on 2026-09-10 — a developer's own stack vanished mid-session). The
branch side now checks out its own HEAD into `<work-root>/branch`, the same
way the base side has always checked out into `<work-root>/main`, and a run
refuses outright if either worktree path would resolve to the invoking
checkout. `-dry-run` prints the plan — both refs, both worktree paths, both
haven slugs, and the ordered commands a real run would issue — and starts
nothing at all: no worktree, no haven command, no install.

Exit status is `0` for no behavioral differences, `1` for differences found,
and `2` for operational or usage errors. With `-ledger-baseline`, only a
root cause the baseline does not name sets `1`. An improved-error finding
(see "Improved-error acceptance" below) never sets `1`, with or without a
baseline — it is the one difference the tool accepts on sight. Progress (boot
phases, per-operation probing) streams to stderr; stdout carries only the
deterministic summary, or the machine report with `-json` (optionally to
`-report FILE`).

## Boot details

- **Each instance is a haven stack** wherever `haven` is on PATH, under its own
  run-scoped slug (`apidiff-<run>-branch`, `apidiff-<run>-main`). haven gives
  each slug its own Postgres and ClickHouse database and its own Redis logical
  database, allocated against the ones live stacks hold, and does the install,
  codegen, migrate and seed itself - so `apidiff run` provisions nothing and a
  run can never reach the datastores the stack you are using sits on. Readiness
  is `haven status --json` reporting the stack's backend lane listening, and the
  instance is addressed on the API port haven allocated. `haven up` runs from
  each instance's own worktree — never from the invoking checkout, which is
  what a directory-registered stack must never share. Teardown is
  `haven destroy <slug>` for exactly those two slugs, run from the work root.
  `-no-haven` boots the old way; `-env-file` is refused alongside haven,
  because pointing the instances at the servers a dotenv names is the thing
  haven exists to stop.
- **A fresh worktree is prepared before either stack boots.** haven's own
  automatic prep is migrate-and-seed, not install-and-build: a worktree
  `git worktree add` just created carries none of a developer checkout's
  generated or built artefacts (`node_modules`, the Prisma client, the
  `langwatch` SDK's `dist`), so `haven up` there used to die in its own
  prepare phase before it ever reached migrate (run 20260910-044221:
  `Cannot find module '.../langwatch/dist/index.mjs'`, then
  `migrations failed - nothing was dropped`). Before either instance's
  `haven up`, both worktrees get the developer's own `.env*` copied in and
  run install/generated-files/build — the identical steps visualdiff runs,
  shared as `havenrun.CopyEnvFiles` and `havenrun.PrepareCommands`
  (`tools/havenrun/prepare.go`) rather than a second definition. A boot that
  never becomes ready reports progress every 30s instead of going silent for
  the whole timeout, and its error carries the last 20 lines of the stack's
  own haven log, read directly off disk
  (`~/.langwatch/portless/logs/<slug>.log`) so a `haven logs` command that
  itself fails does not blank out the failure.
- The paths below describe `-no-haven`. Each worktree boots through a detected profile: `apps/api`
  (`@langwatch/platform-api`) is the **modular** layout (root migrate/seed
  scripts, `API_PORT` on process env — node `--env-file` never overrides it);
  `platform/app` (`@langwatch/web`) is the **monolith** layout (ClickHouse
  migration via `pnpm --filter @langwatch/web clickhouse:migrate`, start via
  `start:app:dev`, `PORT`+`LANGWATCH_API_PORT` pinned to the allocated port).
  The monolith's `env-load.ts` applies `.env` then `.env.portless` with
  `override: true`, so its per-instance env is written to
  `platform/app/.env.portless` before migrate/seed/start — that file wins over
  any `.env` a post-checkout hook copied into the worktree. Any other layout
  errors clearly.
- Before the first install, `apidiff run` **preflights** external
  infrastructure: all three URLs are parsed, the Postgres one must carry a
  username (psql falls back to `$USER`, prisma does not — the failure is a
  `P1010` eight minutes and two installs later), and each endpoint is dialled
  (Postgres `SELECT 1`, ClickHouse `SELECT 1`, Redis `PING`). Administrative
  statements run against the database `-pg-url` itself names; only the
  compose stack uses the `mydb` constant.
- Each instance gets its own **Redis logical database**, and both are emptied
  before the run and on teardown. The two indices are derived from the run id
  rather than fixed at 14/15, so two concurrent runs cannot collide and no
  previous run's queues, idempotency ledger or caches survive into the next
  one. (Measured before the fix: DB 15 still held 83 keys from the previous
  run while DB 14 was empty — an asymmetry the harness itself introduced.)
- After each side migrates, the run **asserts the migrate landed in this
  run's database** (`_prisma_migrations` is non-empty in
  `apidiff_<runid>_<side>`). The modular profile writes no env overlay and
  relies on node's `--env-file` not overriding an already-set variable; that
  is now an assertion rather than a comment. A URL that will not parse is an
  error too — never a silent fall back to the developer's own environment.
- Infrastructure comes from `dev/compose.dev.yml` under the `apidiff` compose
  project with a generated ports/volumes override (`!override` requires
  docker compose v2.24+), so the tool's stack never collides with a running
  dev stack. ClickHouse is capped at 2g in the override (the dev stack's 4g
  does not fit a 4 GiB VM beside postgres and redis). After compose `--wait`,
  the tool polls postgres itself until `SELECT 1` succeeds AND
  `pg_is_in_recovery()` is false — a fresh-volume postgres can still be in
  crash recovery when the container healthcheck goes green, and probing a
  recovering server produces false findings. On teardown without `-keep`,
  compose `down -v` removes the managed stack; with external servers, exactly
  the run-scoped databases are dropped. `-pg-url`/`-ch-url`/`-redis-url`
  (given together) point at user-managed servers instead; external Postgres
  administration then needs `psql` on PATH.
- Credentials default to the deterministic seed identity:
  `sk-lw-local-development-key` (project key) and the fixed local-dev private
  access token (organization bearer, which also satisfies `admin_api_key`).
  In `run` mode a throwaway `LANGWATCH_INSTANCE_ADMIN_API_KEY` is injected
  into both instances and a fixed SCIM token (`ScimToken` row, plain sha256 —
  both layouts verify identically) is inserted after seeding; probing defaults
  `-admin-key`/`-scim-key` to them. In `probe` mode both stay explicit. A
  scheme without a key never skips the operation — it is probed without that
  credential, and a 401-vs-404 divergence is itself evidence.
- The branch's `/api` ↔ `/api/v1` auto-alias is collapsed: `/api/v1/<rest>`
  and `/api/<rest>` are the same operation for the spec diff, the union, and
  findings — unless `<rest>` opens with its own version segment (`/api/v1/v2`,
  and versioned families like `/api/otel/v1`, `/api/scim/v2`,
  `/api/gateway/v1` never match the rule's prefix). Each side is probed at the
  alias form its own spec documents (`/api/v1` preferred when both exist); a
  side documenting neither is probed at the canonical bare form anyway, so an
  undocumented-but-mounted route still shows up. The transcript records both
  probed paths.
- **URL version mounts are skipped, never reported.** Versioning is negotiated
  through the `X-API-Version` header; `/api/<family>/latest/...` and
  `/api/<family>/<YYYY-MM-DD>/...` are a supported convenience fallback the
  document still publishes, but nothing is built against them, so a difference
  on one is the mount doing its job rather than drift. Such an operation never
  enters the union — not probed, not skipped, not a ledger row — and the spec
  changes that only describe one are dropped with it (`VersionMountPath`,
  `spec.go`). The test is positional, so a family carrying its OWN version
  segment (`/api/scim/v2`, `/api/otel/v1`, `/api/webhooks/v1`) is the real
  surface and stays, and a literal date deeper in a path stays a real segment.
  Measured on run 24 of 2026-09-21: 412 of 615 findings and 346 of 739 spec
  changes were version mounts, including every one of the 58
  `permission-diff:404-200` rows that were queued for a baselining decision.
- Status codes compare by CLASS (2xx/3xx/4xx/5xx): same-class differences
  (400 vs 422, 403 vs 401) are suppressed — the error envelope is
  handlederror's domain — and error bodies (both sides ≥ 400) are never
  compared. Success bodies still get full shape + value comparison.
  `-exact-status` restores exact-code and error-body comparison. The summary
  ends with a `suppressed: N same-class status differences, M error-body
  comparisons` line.
- `/api/gateway` operations are excluded by default (they egress to real LLM
  providers); repeat `-exclude-prefix` to add more.
- Idempotent probes (GET/HEAD/OPTIONS) retry up to 2 times on 5xx with
  backoff (500ms, 1s), so a momentary database restart or recovery window
  degrades into a slow probe instead of false findings. Mutations are never
  retried — replaying one could double-apply — and transport errors fail
  fast. A 5xx that persists through the retries is a real finding.

## Probing depth

- GET/HEAD: one valid request per operation.
- POST/PUT/PATCH: a validation probe (empty or type-confused body, comparing
  the full error envelope shape) plus a valid mutation synthesized from the
  request schema — spec examples win; otherwise enums take their first value,
  required fields only, `date-time` becomes the fixed `2026-01-01T00:00:00Z`.
- DELETE: only with an ID captured from an earlier response this run or from
  the seeded constants.
- Path/required-query parameters resolve from spec examples/defaults, then
  the seeded constants (`local-dev-project`, `local-dev-organization`,
  `local-dev-team`), then IDs captured from earlier responses. Resolution
  happens **once per side, against that side's own symbol table**: each
  instance mints its own IDs, and one shared table sent the base's ID to the
  candidate and manufactured 404-vs-200 status differences. When only one
  side resolves, the operation is skipped with a reason naming that side
  (root cause `harness-symbol-table`) rather than probed as an asymmetric
  pair. Captured IDs are **typed** by the parameter they can satisfy — the
  response key they came under, and for a bare `id` the resource its own path
  names (`POST /api/prompts` files a `promptId`). There is no untyped
  catch-all: an operation whose `{promptId}` has no captured prompt ID is
  skipped, not probed with a trace ID.
- The union's probing definition (parameters, body schema, security) comes
  from the **candidate**, so an operation the branch changed is probed with
  the branch's shape; each side's own declared body is kept on the operation
  (`bodySchemaA` / `bodySchemaB`).
- **Collection verification** (after the main pass): when a mutation created
  an entity, every matching list GET (same path, or the GET path is an
  ancestor of the POST path) is re-probed and the entity must be VISIBLE in
  each side's list — `mutation_not_visible` when exactly one side loses it.
  The re-probe is an **event-driven settle**, never a fixed sleep: the list
  is re-read until the entity is visible on both sides or `-settle-timeout`
  (default 10s) passes, and the finding says how long it waited and for what.
  One side visible and the other not gets the whole timeout — that is the lag
  worth waiting out; neither side visible gets a quarter of it, because that
  is usually a collection the creation does not populate at all.
  Visible-on-both means the non-empty list shapes get compared, which is the
  real layout check. A list GET that answered 2xx with empty lists on both
  sides and had no mutation coverage is reported as `unverified_shape`
  (coverage note, never a difference, own section in the report).
- **Permission probes** (after the main pass): every project-key read is
  repeated with the sibling-project key (B: same org, wrong project) and the
  foreign-org key (C). The foreign request carries **only** the project-key
  header — an operation whose security also admits an organization bearer or
  an admin key is skipped rather than probed with the owner's second
  credential still attached, which used to make a legitimate success read as
  a leak. The leak candidates are the IDs the OWNER key saw on **that same
  operation**, minus the identities the foreign key legitimately owns (its
  own project, and the organization and team it sits in — shared and
  cascading scope is not a leak), and the finding **records the matched ID**.
  A denial class disagreement is a `permission_diff`; an operation that
  already differs on the owner key is skipped entirely, since replaying it
  with two foreign keys only re-reports the same root cause twice more.
  Mutations are never replayed with foreign keys.

  One class survives the rule: an endpoint that serves the same instance-wide
  document to every key (model defaults, providers) cannot be told apart,
  from its responses alone, from one that leaks to every key. Those are
  reported, and the recorded ID is what settles it on sight. `run` mode provisions the fixtures (org 2, project B,
  project C — fixed IDs, plaintext legacy-format keys, `ON CONFLICT` safe)
  and defaults the keys; `probe` mode needs `-project-key-b`/`-project-key-c`.

## Self-protection — the run may not destroy what it authenticates as

A difference that disappears must never be indistinguishable from a difference
that was fixed. Run 8 of 2026-09-15 is the whole argument: probe #181 issued
`DELETE /api/projects/{id}` against `local-dev-project`, whose `apiKey` **is**
the probe credential. Both sides archived themselves, every project-key probe
from #182 on answered `401` on both sides, the two sides AGREED — and seventeen
differences left the report reading as fixes while coverage collapsed.

Three mechanisms now stand between a run and that outcome
(`self-protection.go`, `credentials.go`):

- **Retargeting.** A destructive operation — any `DELETE`, plus the
  `regenerate-api-key` / `rotate-api-key` forms — whose resolved parameters
  name a row the run depends on is aimed at a **sacrificial** row of the same
  kind instead (`fixtures.go` provisions `apidiff-project-doomed` and
  `apidiff-team-doomed` in the seeded organization). Coverage is kept whole:
  the same route, the same credential, the same authorization decision. Both
  sides substitute from the same table of literal IDs, so A and B still issue
  identical requests. Each substitution prints a `retarget` progress line and
  is visible in the transcript's own `requestPathA`/`requestPathB`.
- **A named skip.** A protected row with no sacrificial twin — an organization
  carries the bearer token, the SCIM token and the plan the entitled pass
  elevates, so a second one is not a substitute — blocks the operation. It is
  reported as a skip whose root cause is `self-destructive-target`, its own
  slug in the ledger, never folded into `unresolvable-parameter`. A lost
  comparison is a row, not a silence.
- **The closing assertion.** Every credential is read once before the first
  probe and once after the last, through a parameterless operation its own
  security scheme selects. A credential that authenticated at the start and is
  refused at the end sets `lost` on its `credentialChecks` entry, prints
  `CREDENTIAL LOST:` on stderr and exits **2**, because such a run measured two
  refusals rather than the branch. A credential that never authenticated, and
  one the union documents no way to read at all, are reported too — "nothing
  printed" and "nothing checked" must not look alike.

The first two stop the cause that is understood. The third is what catches the
next one.

## Entitled pass

Some operations answer with the handled-error code `enterprise_plan_required`
before they do anything else — the plan gate refuses the request outright.
Stopping the comparison there tests only whether the two sides AGREE on the
gate, never what either side does BEHIND it. After the main pass (and its
collection/permission follow-ups), every operation either side gated is
re-probed with the seeded organization (`local-dev-organization`) entitled to
an Enterprise plan, tagged with its own case, `entitled`, so the report can
tell "the gate disagreed" apart from "behavior behind the gate disagreed".
Detection reads the `error.code` field out of the body — never a hardcoded
path list — so a gate on a surface added later (SCIM, the webhook endpoints
that already check `assertEndpointsEntitled`) is caught the same way.

Activation is a live, mid-run database write, not a boot-time flag: `run`
mode `UPDATE`s the `Organization.license` column both layouts read fresh on
every request (branch:
`PrismaOrganizationLicenseRepository.tryReadLicense`; main:
`LicenseHandler`'s `readStoredLicense`), for `local-dev-organization`, on
BOTH instances' databases, with the same pre-signed ENTERPRISE license the
local-dev seed itself writes
(`LOCAL_DEV_ENTERPRISE_LICENSE_KEY`, read at runtime from
`enterprise/modules/licensing/process/src/seeding.ts` in the branch checkout —
never copied into Go source, so a rotation is caught by a failing read
instead of silently entitling nothing). No restart, and nothing is skipped on
the unentitled pass to make room for it: the original gate refusal stays its
own finding, under the ordinary case.

`probe` mode has no database and never activates anything; `run`'s haven path
provisions no fixtures at all (same reason the SCIM and permission-probe
fixtures are skipped there — a haven stack's database belongs to haven), so
the entitled pass is skipped too, noted on stderr rather than silently doing
nothing.

**The activation attempt can genuinely do nothing, and the pass reports that
honestly rather than papering over it.** Elevating the database row only
changes an operation's answer if that process actually reads a license
source at all. If a layout's plan resolution never composes one — the branch
process opened no license source, say — the re-probe still runs and still
answers the same gate refusal, and that shows up as its own `entitled`-case
finding: real signal that the gap is architectural, not a probe that forgot
to check.

## Improved-error acceptance

One direction of drift is accepted by the tool itself rather than left for a
human to baseline: **main answering a failure it does not attribute to any
particular cause, and the branch answering a handled 4xx with its own stable
code instead.** If it used to blow up and now it returns a 400 with a proper
validation body, that is the fix working, not a regression to chase.

A finding qualifies as `error_improved` iff BOTH hold:

1. **Main's answer is unowned.** Status 5xx (unowned by construction,
   whatever the body says — `apps/api/src/app/api-canonical-error.ts`'s
   `handledErrorEnvelope` forces the generic `internal_error` code onto
   every 5xx it emits, discarding even a `HandledError`'s own code), or a
   body reporting that same generic code at some other status.
2. **The branch's answer is a handled refusal at least as good.** A 4xx
   whose body carries a stable code — either envelope shape apidiff probes:
   the REST wrapper (`{"error":{"code":...}}`) or the flat shape
   (`{"code":...}`) — and that code is not itself the generic placeholder.

Every other direction keeps failing exactly as before. In particular:

- **The reverse never qualifies.** Main answering a clean 4xx and the branch
  degrading to a 5xx is `handled-refusal-degraded`, a defect, whichever
  status pair it is — a 5xx is never auto-accepted on the candidate side,
  even a named handled 503.
- A main 2xx becoming anything else, a main 4xx becoming a *different* 4xx
  (401→402), and a main 4xx becoming a 2xx are all still ordinary drift —
  the last one is a permission/publication change for a human to decide,
  not something this rule grants.
- **Ambiguity resolves to NOT improved.** An unparsable or codeless body on
  either side fails the qualification closed, not open; the finding is
  reported as the ordinary `status_diff` it would have been anyway.

An improved-error finding still lands in the report (its own section,
`error_improved`, plus a one-line count in the summary: `improved: N
operation(s) replaced a base 5xx (or unhandled) failure with a branch
handled 4xx`) and in the ledger, under its own root-cause slug,
`error-improved:<before-status>-<after-status>`. It never counts toward
`report.Differences`, and its ledger cause is always reported `known` —
neither needs `-ledger-baseline` to stop failing the run. An improved-error
finding raised by the entitled pass (see "Entitled pass" above) carries the
same `entitled:` namespace every other entitled-pass cause does:
`entitled:error-improved:402-400`.

## The ledger

A run's `-report` is the evidence; the **ledger** is the worklist. Every
difference row carries a `rootCause`, a stable slug derived from the
finding's kind and the specific status pair, and the ledger groups rows by
it — so a report opens with `root causes: 13 causes across 41 operations`
instead of 78 rows to sort by hand. In the 2026-09-05 trial run that single
field collapses the 14 webhook rows into one
`handled-refusal-degraded:403-503` and groups the five not-found regressions
as one `not-found-as-500:404-500`.

`ledger.json` is written beside `-report`'s file automatically, or wherever
`-ledger FILE` says. Its shape:

```json
{
  "totals": { "unionOperations": 303, "probed": 275, "skipped": 4,
              "differingOperations": 41, "causes": 13,
              "newCauses": 2, "knownCauses": 11 },
  "causes": [ { "rootCause": "not-found-as-500:404-500", "kind": "status_diff",
                "count": 5, "operations": ["GET /api/prompts/{id}"],
                "known": false } ],
  "operations": [ { "method": "GET", "path": "/api/annotations",
                    "operationId": "listAnnotations", "presence": "both",
                    "cases": ["read"], "classification": "equal",
                    "rootCauses": [], "sideStatus": [200, 200],
                    "known": false } ]
}
```

There is **one row per operation in the union**, differing or not.
`classification` is a closed enum: `equal` · `equal-suppressed` · `differs` ·
`missing-a` · `missing-b` · `skipped` · `not-probed` · `unverified`.
`sideStatus` and every `[before, after]` pair read `[base, candidate]`.

Cause slugs: `not-found-as-500:<pair>`, `handled-refusal-degraded:<pair>`,
`server-error-resolved:<pair>`, `route-absent-on-candidate:<pair>`,
`route-absent-on-base:<pair>`, `status-class-mismatch:<pair>`,
`error-improved:<pair>` (see "Improved-error acceptance" above — always
reported `known`, baseline or not), `operation-missing-on-candidate`,
`operation-missing-on-base`, `permission-leak`, `permission-diff:<pair>`,
`mutation-not-visible`, `body-shape-diff`, `body-value-diff`,
`error-shape-diff`, `probe-failed`, `unresolvable-parameter`,
`harness-symbol-table` (a harness artifact, not an API difference),
`unverified-list-shape`, and `spec-<change kind>`. A finding from the
entitled pass (see "Entitled pass" above) gets the SAME slug an identical
finding would get from the main pass, prefixed with its own namespace —
`entitled:handled-refusal-degraded:402-200`, never bare
`handled-refusal-degraded:402-200` — because "the gate disagrees" and
"behavior behind the gate disagrees" are never the same fix.

`-ledger-baseline FILE` takes a previous `ledger.json` (or a plain JSON array
of slugs) and marks those causes **known**: they are still reported, still
counted, and no longer fail the run. Only a cause the baseline does not name
exits `1`. That is how a branch ratchets from 40 causes to 0 without the tool
being red the whole way. Every `error-improved:<pair>` cause is marked known
unconditionally, baseline present or not — it is the one cause that never
needs to be named to stop failing the run.

## Findings stream

`run` (not `probe`, which has no run directory) appends one JSON line to
`<work-root>/findings.jsonl` as each operation's comparison completes — a
reader can `tail -f` it during the run instead of waiting for the final
report and ledger. Each line is its own `Write`, flushed immediately, so
nothing is batched across findings:

```json
{"surface":"rest","name":"GET /api/prompts","kind":"identical","module":"prompt","detail":"","capturedAt":"2026-09-10T00:00:00Z"}
```

`surface` is `rest` or `trpc` (the latter reserved — see "Not covered"
below). `kind` is one of `absent-on-branch`, `status-differs`,
`shape-differs`, `identical`, `probe-failed`; a probe failure or a
missing-on-branch result wins over a mere status or shape difference. `module`
is the module directory under `modules/` that best-effort matches the
operation's path (a first path segment, singular/plural tolerant), or empty
when nothing matches — most of the REST surface predates the module layout,
so that is the common case. `detail` is one line: the status pair, the
changed field pointers, or the skip/failure reason. The stream closes with one
`{"kind":"run-complete","counts":{...}}` line totalling every kind emitted.

## Not covered

The ledger and the probes describe the **REST** surface only. The browser
talks to roughly a hundred tRPC procedures that the OpenAPI document does not
describe, so the tool sees none of them: a zero here is a REST zero. Closing
that needs a procedure manifest emitted from the tRPC chain (procedure path,
kind, input/output schema from the zod schemas, the declared access policy)
served beside `/api/openapi.json`, then probed in lockstep over the batch
link with the same ladder. That seam is deliberately left open.

No worker process is booted on either side, so anything whose observable
result depends on a queue, projection or scheduler is compared in a state
neither instance reaches in production.

### The union blind spot — a route absent from *both* documents

The probe set is the union of the two OpenAPI documents. A route that appears
in neither is not compared, not skipped, and not counted: it is invisible, and
the run is silent about it. Silence here is indistinguishable from agreement.

This is not hypothetical. On 2026-09-15 the entire trace **ingestion** surface
— `POST /api/collector`, `POST /api/otel/v1/traces`, the OTLP path-alias
dispatcher, tracked events and trace export — was found defined, exported and
mounted nowhere on the candidate branch, while both shipped SDKs and our own
`services/langyagent` post to those paths. Seven runs of this tool had reported
on that branch and none could have found it, because the ingestion routes are
not in the OpenAPI document on either side. The nine-operation REST teams
family went the same way and was found only because it happened to be *in*
main's document, which is the difference between a diff finding and a silent
hole.

So: **a clean apidiff run means the documented surfaces agree. It does not mean
the branch serves what its customers call.** Two other instruments are needed
and neither is this one.

1. A static check that an exported transport factory is actually named in some
   `withTransports(...)` list. It catches the defect at the commit that drops
   the registration rather than months later, and it needs to allow one
   aggregator hop (a router bundled by a mounted transport file) and to match
   an initialiser loosely — the alias dispatcher is built with
   `CANDIDATE_PATHS.reduce(...)`, so a declaration-shape regex misses the most
   important case in the set.
2. A contract test asking whether every route the SDKs, the docs and the
   Terraform provider reference actually exists on a booted stack. That is
   neither a diff nor a lint, and nothing in the repository does it today.

Do not extend this tool to cover either. Its comparison is between two running
stacks, and both of those questions are answerable without a second stack.

Finding kinds: `status_diff` (status-class changes only, by default),
`body_shape_diff`, `body_value_diff` (success bodies only), `error_shape_diff`
(`-exact-status` mode only), `operation_missing`, `permission_leak`,
`permission_diff`, `mutation_not_visible`, `probe_failed`, `skipped`
(unresolvable parameters), `unverified_shape` (coverage notes).
