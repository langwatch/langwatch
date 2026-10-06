# Held questions for Alex

Tracking issue: https://github.com/langwatch/langwatch/issues/8493; the PR-body refresh lane syncs it from this file.

Alex, 2026-10-06 night: "no more questions for now, hold them somewhere for me later". Every
question a lane or the coordinator raises goes HERE, not to Alex, until he asks for them. Ask them
only when he says so ("ask anything now" or similar), in rounds of four, recommendation first.

Standing instructions that hold until Alex says otherwise:

- Do work in lanes, never in the coordinator's own context (2026-10-06 evening).
- Keep PR #7536's body current with every decision, stat and lane outcome; refresh it through a lane
  after each landed batch (2026-10-06 night). Header and footer stay real and dated.
- Cut the PR body to a short squash summary just before merge (ruled 2026-10-06 night).
- A lane that hits an open question proceeds on the plan's marked recommendation where one exists,
  records it below as "default taken, held for Alex", and keeps going; with no recommendation it stops
  that item and records it here.

Format: one line per question: id, source file and section, the question, the options, the
recommendation, and "default taken" if a lane proceeded on it.

## Open

### Upgrade UI (dev/docs/plans/upgrade-ui-2026-10-06.md §11; Alex declined this round on 2026-10-06)

- Q-U5 Rollback rules: (1) a serving process refuses below the ledger's floor; (2) level-triggered background steps re-run after rollback and re-upgrade. Options: both, floor only, neither. Recommendation: both.
- Q-U6 Cloud regions in the fleet: regions send the same usage report so one fleet page covers cloud and self-hosted, or each region keeps its own page. Recommendation: report.
- Q-U7 Self-hosted alert channels: email platform operators plus the operator banner; Slack only where ops' notifier is configured. Recommendation: yes.
- Q-U8 How ops gets the upgrade reader: (a) ops' registry builds it and the framework hands the step list as a resource; (b) a framework-owned read surface; (c) the ledger alone with step metadata copied at run time. Framework shape; S6's design.
- Q-U9 Ten ops system-migration procedures become `ops.upgrade.*`: accept the operator-only wire difference, or aliases for one release. Recommendation: rename, no aliases.
- Q-U10 Organization admins see held or archived state: recommendation no (legacy path serves, refusals opaque, record §3.5).
- Q-U11 Steps carry a required one-line description shown in UI and CLI (SQL steps take the first comment): recommendation yes.

### Legacy error body (legacy-error-root hand-back, 2026-10-06 night; landed)

- LE-1 Breadth: the root `error` is added only at statuses where a route publishes main's flat body (75 operations, 18 families); unpublished statuses (403 on most of them) get none, where main sent it on every status. Released clients only parse documented statuses. Options: keep (default taken, held for Alex) or every refusal of such a family (one line in packages/api/src/rest/legacy-error.ts).
- LE-2 Masked 5xx: main sent a HandledError 5xx's code unmasked; the branch masks per §12 and sends "Internal server error". Default taken: keep the mask.
- LE-3 Other legacy shapes not covered: `{error, kind?, meta?}` on evaluations-legacy, guardrails and dataset evaluate, and the CLI OAuth `{error, error_description}` (about 20 operations). Default taken: leave as they are until apidiff names a client break.

### Migrations blitz (dev/docs/plans/migrations-blitz-2026-10-06.md §4; coordinator design, held for Alex; lanes proceed on each recommendation)

- D1 One model for cloud and self-hosted: the ledger is keyed by step id (and target); version only in self-hosted stepping and the floor; cloud keyed by step id plus presence, never a number. Options: this, or a cloud build number. Recommendation: this. Coordinator design, held for Alex.
- D2 Presence: api and worker report image and declared step ids to a runner-owned `_langwatch_upgrade_presence`; "old writers gone for step S" is computed and replaces the operator-typed `minimumWriterGeneration` drain assertion (kept as an override). Options: presence, keep the manual assertion, deploy-tool signal. Recommendation: presence. Coordinator design, held for Alex.
- D3 "Split by module" for SQL: code steps per module via `.withMigrations` (ruled); SQL stays in the two central directories, each migration attributed to its table owner and a check refuses one touching two owners. Options: (a) attribute only, (b) move SQL files into modules with a runner-assembled directory and per-owner goose tables, (c) new SQL in modules, history central. Recommendation: (a) now, (b) only if "no central list" covers files. Coordinator design, held for Alex.
- D4 Q-U1 (a) stored as a child table `_langwatch_upgrade_target`, additive, step status the aggregate. Options: child table, widen the step primary key, target in the step id. Recommendation: child table. Coordinator design, held for Alex.
- D5 The serving refusal hooks as a `Server` preamble step (`withUpgradeGate`) in packages/process, api and worker only, after stores open, before serve; it also writes presence. Options: preamble step, app main.ts call, readiness check only. Recommendation: preamble step. Coordinator design, held for Alex.
- D6 The guard also refuses lock-heavy shapes (plain index on an existing table without the pre-build note, enum recreation, unique or validated constraint on an existing table, column type change) and migration sessions set `lock_timeout`. Recommendation: yes. Coordinator design, held for Alex.
- D7 CI gates: per-PR N-1 job (base code on head-migrated schema; cloud's side-by-side proof), nightly LTS-floor image job, Prisma drift job, stamp in the release PR. Recommendation: all four. Coordinator design, held for Alex.
- D8 Contract steps wait for the LTS floor on cloud too (one tree, one window, no cloud-only early contract). Recommendation: yes. Coordinator design, held for Alex.
- D9 Manifests in `packages/upgrade/releases/<version>.json`, floor in `packages/upgrade/releases/lts-floor.json`, not a new top-level `migrations/`. Recommendation: yes. Coordinator design, held for Alex.
- D10 The first LTS floor: the last release cut before this branch merges (3.20.1 today); older installs take one stop there. Recommendation: 3.20.1 (or whatever is newest at merge). Default taken by mig-s2-manifests, held for Alex.
- D11 Ordering collisions stay keys plus the migration-order check, extended to refuse a goose number main already used; no Atlas-style sum file. Recommendation: yes. Coordinator design, held for Alex.
- Q-U8 (recommendation added) The `upgrade` run registers every declared step into the ledger, ops' registry builds `UpgradeReader` over its Postgres handle as it drives replay, background steps run in the worker in their declaring module's context; the record's "the runner belongs to ops" becomes "ops reads and requests; the framework runs". Default taken by mig-declare and mig-u2-ops-ui, held for Alex.
- Q-U5 both, Q-U10 no, Q-U11 yes: default taken by mig-serving-gate and mig-s3-runner (Q-U5), mig-u2-ops-ui (Q-U10), mig-declare and mig-ledger-widen (Q-U11), held for Alex.
- U1-a Empty ledger state (UI plan section 4 has seven states and none for "no upgrade recorded yet"): the reader answers Behind with the reason code `no-upgrade-recorded` and the summary "No upgrade recorded yet", adding no eighth state. Options: this, or an eighth state. Recommendation: this. Default taken by mig-u1-reader, held for Alex.
- U1-b "Upgrading" before the lease table exists: an `upgrade` run with no finished_at stands in for the lease (a crashed run reads Upgrading until the lease table lands); once the table exists only an unexpired lease counts. Options: this, or never Upgrading before the lease. Recommendation: this. Default taken by mig-u1-reader, held for Alex.
- U1-c Reader wire conventions: instants leave the reader as ISO 8601 UTC strings (the temporal-only rule bans Date on a declared type) and a missing step or run is refused with `UpgradeReadError` code `upgrade_not_found` (`upgrade_invalid_cursor` for a bad cursor), a plain error class in packages/upgrade because the package has no `@langwatch/handled-error` dependency. Options: this, or add the dependency and extend HandledError. Recommendation: this until ops' transport maps the codes. Default taken by mig-u1-reader, held for Alex.
- mig-guard NEW_RULES_FROM: the Prisma scanner holds only migrations written after 20261006170527_data_privacy_project_scope to the six new floor and lock rules; the unmerged branch migrations 20261006170500 to 20261006170512 (unique and plain indexes on existing tables) and the older ones answer to the four old rules only, via a second marker in the test (not the baseline). Options: this marker, or have those migrations carry the ops pre-build note. Recommendation: the marker; default taken, held for Alex.
- mig-guard `migration-touches-two-owners` (D3) skipped: table ownership is computed by the enforcer from repository claims over a workspace snapshot, and `@langwatch/prisma-client` and `@langwatch/clickhouse-migrations` cannot reach it without a new dependency or a generated owner map. Options: a generated table-to-owner map emitted by the enforcer, or the enforcer runs the check as a policy over the migration folders. Recommendation: the enforcer policy. Rule not written, held for Alex.
- mig-guard `set-not-null-on-populated-column` has no escape hatch (a NOT VALID check validated later is the only route; no "writers all fill it" note exists). Options: this, or a `-- contract: written in <release>` note checked against the floor. Recommendation: this until a real case needs the note; default taken, held for Alex.
- Ledger widening (mig-ledger-widen): `findLivePresence({ staleAfterMs })` reads the database clock and takes no `now` (the manifest's `{ now, staleAfterMs }` mixed the caller's clock with the DB-clock heartbeat, and the temporal-only lint refuses a `Date` parameter); `acquireLease` answers null when a live holder keeps it, `renewLease` and `releaseLease` act only for the owner, `registerDeclaredSteps` refreshes owner and description but never a status, and a declared step with an empty description is refused (Q-U11). Options: take a `Temporal.Instant` `now` (needs `@langwatch/time` in packages/upgrade), or keep the DB clock. Recommendation: the DB clock; default taken, held for Alex.
- mig-s2-manifests owner attribution (D3): the stamp takes the table-to-owner map as `--table-owners <json>` and leaves `owner` null when unresolved. The 3.19.0 to 3.20.1 backfill used a map read from the enforcer's Prisma claims, which cover 50 tables today, so 3 of 4 backfilled steps have a null owner. No ClickHouse map exists. The plan names no way for the release PR to get the map. Options: the enforcer prints the generated map (the same one mig-guard's held line names) and mig-ci passes it, or packages/upgrade takes a devDependency on the enforcer. Not wired; held for Alex.
- mig-s2-manifests fresh install: the planner marks only data, tenant and procedure steps `not-needed` (rethink 6.4's list). The `event-upcast` kind the upcaster lane added is planned by its mode instead. Options: also `not-needed` on a fresh install, or planned. Rethink's list is followed as written; held for Alex.
- Cloud presence (mig-cloud-presence): `createPresence` takes no `clock` though its manifest named one, because the repository stamps and judges presence on the database clock (ledger widening line above) and a process clock would only bring skew back. Recommendation: no clock; default taken, held for Alex.
- Cloud presence (mig-cloud-presence): `oldWritersGoneFor` answers true when no process is live at all (manifest target shape). Options: true, or refuse to answer with no live row. Recommendation: true; default taken, held for Alex.
- Cloud presence (mig-cloud-presence): a serving process whose presence refresh keeps failing drops out of presence while it still serves, so "old writers gone" can turn true early. Options: (a) the serving gate stops serving once its own last good write is older than the stale bound, (b) accept the window. The plan names none; lane suggestion (a), for mig-serving-gate. No default taken.
- Cloud presence (mig-cloud-presence): the stale bound and refresh interval. The plan names no numbers; `createPresence` takes both and refuses an interval not below the bound. Lane suggestion: refresh 15 s, stale 60 s. No default taken; mig-serving-gate sets them.
- Cloud presence (mig-cloud-presence): ArgoCD and Flux run pre-upgrade hooks on every sync, rollbacks included (`charts/langwatch/templates/app/migrate-pre-roll-job.yaml:38-41`). Whether cloud's deploy does, and whether `upgrade` from an older image is then a pure no-op (Q-U5 2 re-marks background steps pending), is a research gap (plan section 7). No default taken.
- Cloud presence (mig-cloud-presence): "presence" is also the name of the `presence` module (`PresenceApi`, browser broadcast). Options: keep D2's name inside packages/upgrade, or rename it (for example "serving roster"). Recommendation: keep; default taken, held for Alex.

### SDK paths (sdk share-path lane, 2026-10-06 night)

- SDK-1 The generated Python client publishes `/api/v1/traces/{trace_id}/transcript`, while the hand-written BARE_ONLY lists say the trace family has no /api/v1 twin. Either the document carries a v1 twin the lists should admit, or the transcript route should be bare. Needs a look at the trace routes' addressing; no default taken.
- U2-API (mig-u2-ops-ui, no recommendation, item stopped): every ops tRPC handler calls the module's `*Api` (`defineTrpcRouter(OpsApi, ...)`, `modules/ops/process/src/transport/ops-platform.trpc.ts:15-18`), so the six `ops.upgrade.*` queries need new `OpsApi` operations, which UI plan section 8 says are not proposed. Options: (a) six `OpsApi` operations (`upgradeStatus`, `listUpgradeReleases`, `listUpgradeSteps`, `getUpgradeStep`, `listUpgradeRuns`, `getUpgradeRun`) backed by an ops service over `UpgradeReader`; (b) one operation per read through a single `upgrades` sub-object; (c) a framework way for a router to call a service, a `packages/api` change. Held for Alex.
- U2-LIVE (mig-u2-ops-ui, no recommendation, item stopped): the manifest asks W4 to poll while a run holds the lease; the record forbids timer polling (`dev/docs/ARCHITECTURE.md` section 10, "No timer polling", Alex 2026-10-01). No polling was built. Options: the runner (apps/tasks) raises a read hint the api can relay; a polling exception like the suites page's; refresh on show only. Held for Alex.
- U2-PHASES (mig-u2-ops-ui, no recommendation, item stopped): `UpgradeReader.getRun` answers steps, plan and report but no phases (preflight, per-release Postgres and ClickHouse schema, reconcile) that UI plan W4 lists; W4 shows the run's steps per release instead and the phases scenario is `@unimplemented`. Options: the runner records phases in the run report with a fixed shape the reader parses; a phase table; steps-per-release is enough. Held for Alex.
- Q-U2 (mig-u2-ops-ui): copy says "release upgrade" wherever a plan upgrade could be meant. Default taken, held for Alex.
- S4-TARGETS (mig-s4-stepping-proof): `applyRelease` runs every ClickHouse target even after one fails and reports each, and the release is not ok (plan section 4, D4: a failed target fails the run); default taken, held for Alex.

### Event upcaster (eventing-upcaster lane, 2026-10-06 night)

- UP-1 Ledger kind: the upcast is recorded as a new step kind `event-upcast` (mode `background`), beside plan 6.1's five kinds, so the Upgrades page can list upcasts apart from data steps; the alternative is kind `data` with an `upcast` marker in the report. Default taken (`event-upcast`, the manifest names "the upcast step kind"), held for Alex.
- UP-2 Step id: `upcast:<pipeline>:<stored type>` (eventing's `upcastStepId`), not plan 6.1's `<module>:<name>`, because a pipeline does not know its module and pipeline names are already unique. Default taken, held for Alex.
- UP-3 Who records the steps and how ops is handed `EventUpcastReader`: ops builds it over `pipelineUpcastsOf(eventing.definitions)` and its ClickHouse replay source, and the runner (S5) calls `UpgradeLedgerRepository.recordUpcastSteps`. Same open question as Q-U8. No default wired; the reader exists, nothing calls it in a process yet.
- UP-4 Rewrite storage: event_log is `ReplacingMergeTree(EventTimestamp) ORDER BY (TenantId, AggregateType, AggregateId, IdempotencyKey)`. A type-only rewrite re-inserts the row (same key) and the merge drops the original; an aggregate rename changes the key, so the original needs a lightweight DELETE after the copy, which the "copy, never move" step rule forbids until the floor passes. Recommendation: rewrite = re-insert copies (reads dedupe by event id, already built); delete originals only as a later contract step at the LTS floor. Held for Alex; rewrite not built.
- UP-5 Drain lifetime: `drain` lives on the `.withUpcasts` declaration and is meant to be removed one release after the rename; nothing enforces the removal. Options: a lint naming drains older than one release; an ops warning when the old keys hold no jobs. Held for Alex.

### Older numbered questions

- Up to 79 ids in `.claude/coordinator/questions-2026-10-06.md` that no ruling cites (Q11 to Q13, Q29 to Q39, Q43 to Q78, Q86 to Q152, Q155 to Q220); an upper bound, several are coordinator defaults for review.
- Bind round 2 rows (91 as written; identity 33, product 30, Langy and agents 15, platform 9, access 4), in the bind handoffs; re-count before asking.

## Answered (moved to `.claude/coordinator/rulings-2026-10-05.md` when ruled)

- Q1-upcast: ruled 2026-10-06 night, option (a), a framework upcaster, accessible in ops and the migrations ledger.
