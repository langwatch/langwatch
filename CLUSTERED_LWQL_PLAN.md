# Plan — Clustered ClickHouse in scope for LWQL self-provisioning (PR #7331 scope extension)

Branch `issue6635/lwql-helm-enablement`, head `16dc91e431`.

## 1. Goal

Remove the `replicas > 1` exclusion from LWQL self-provisioning and replace it with working
clustered support, so a chart-managed 3-replica ClickHouse provisions the full LWQL access model
on every node.

## 2. Non-goals

- Multi-**shard** ClickHouse. The chart's replicated mode is 1 shard / N replicas
  (`clickhouse.go:54-62` renders a single `shard` key). Sharding is out of scope.
- Changing the SaaS terraform path (`langwatch-saas`), which stays static-users.xml + per-replica
  named collection.
- Changing the LWQL statement builders' SQL. No `ON CLUSTER` is added anywhere — see §5.
- Releasing the `clickhouse-serverless` image. A release past 0.3.0 is already a prerequisite of
  this PR (issue #7349); this plan adds no *new* release dependency.

## 3. The decision: keeper-backed storage, not app-side fan-out

**Recommendation: keeper-backed replicated storage, configured by the Go renderer in replicated
mode only.** Two config files, no application change.

Why this over the SaaS fan-out pattern:

| | Keeper-backed | App-side fan-out loop |
|---|---|---|
| App change | none | new pod-DNS discovery + N-way statement loop in `provisionLwql.ts` |
| Scale-up 3→5 | new replica reads keeper, self-heals | stale until next app boot (issue #7374 class) |
| Failure mode | server rejects config at start, loud | partial success: entity on 2 of 3 nodes, silent skew |
| Endpoint the app dials | one (the k8s Service) | must bypass the Service and address pods directly |
| Ordering hazard | none | `CREATE USER OR REPLACE` re-minted per node → the id churns |

The fan-out loop's fatal property is that it makes the app's provisioning correctness depend on pod
topology it does not own. The load-balanced Service is precisely what the app should be talking to,
and keeper-backed storage is the ClickHouse-native answer to "make this DDL cluster-wide". The
renderer already owns replicated-mode config (`renderKeeper`), so this is an extension of an
existing seam, not a new one.

Cost of being wrong: low and reversible — the config is two files gated on `input.Replicated`.

### 3a. Why no `ON CLUSTER`, and why the database-scoped DDL already works

Established and re-confirmed: migration `00001_create_database.sql` uses the **Replicated** database
engine when `CLICKHOUSE_CLUSTER` is set, and later migrations state that `ON CLUSTER` against a
Replicated database is *rejected*. So `lwqlViewSetupStatements` / `lwqlPostgresEngineTableStatements`
(views + engine tables, all database-scoped) already fan out via the engine.

Boot-order check (`platform/app/package.json:39`): `start:prepare:db` = `prisma:migrate &&
clickhouse:migrate && lwql:provision`. Migrations run **first**, so by provisioning time the
database exists with the Replicated engine and LWQL's `CREATE DATABASE IF NOT EXISTS` is a no-op.
`derivedAdminTarget` (`selfProvisioning.ts:133`) takes the database from `CLICKHOUSE_URL`'s own path
and *refuses* a divergent `LWQL_DATABASE`, so there is no path where provisioning creates the
database ahead of goose with the wrong engine. **Verify this explicitly in step 6** — it is the one
assumption that would invalidate the "no fan-out needed" conclusion.

What is left as genuinely per-node is exactly two things, and each gets one config file:

1. SQL-created access entities — user, settings profile, grants, row policies
   (`lwqlClickHouseSetupStatements` → `provisioning.ts:480`) → `user_directories` replicated.
2. The named collection (`postgresNamedCollectionStatements` → `postgresMapping.ts:68`) →
   `named_collections_storage` type zookeeper.

## 4. Files to change

| File | Change |
|---|---|
| `infra/clickhouse-serverless/internal/render/access.go` | add `renderUserDirectories`, `renderNamedCollectionsStorage` (replicated-only) |
| `infra/clickhouse-serverless/internal/render/render.go:63-68` | call both from the `if input.Replicated` block |
| `infra/clickhouse-serverless/internal/render/render_test.go` | unit coverage both modes |
| `infra/clickhouse-serverless/CHANGELOG.md` | entry (feeds release-please) |
| `charts/langwatch/templates/_helpers.tpl:1240-1266` | drop the `replicas > 1` clause + rewrite comment |
| `charts/langwatch/templates/_helpers.tpl:854-863` | rewrite the env-block rationale comment |
| `charts/langwatch/templates/NOTES.txt:322,333,340-343` | delete the skip warning |
| `charts/langwatch/values.yaml:1968-1976` | rewrite the comment block above `lwql:` |
| `charts/langwatch/README.md` | regenerate/adjust the `lwql.enabled` description |
| `charts/langwatch/tests/e2e-overlays.sh` | template-level assertion: env present at replicas=3 |
| `charts/langwatch/tests/e2e.sh` | parameterize `test_lwql` for per-pod assertions |
| `charts/clickhouse-serverless/README.md` | document the two new replicated-mode config files |
| `specs/analytics/lwql-api.feature` | new scenarios (§8) |

## 5. Step sequence

**Step 1 — renderer: `user_directories`.** In `access.go`, add:

```go
func renderUserDirectories(input *config.Input, configD string) error {
    return writeYAML(filepath.Join(configD, "user-directories.yaml"), map[string]any{
        "user_directories": map[string]any{
            "@replace": "replace",
            "users_xml":  map[string]any{"path": "/etc/clickhouse-server/users.xml"},
            "replicated": map[string]any{
                "zookeeper_path": "/clickhouse/" + input.ClusterName + "/access/",
            },
        },
    })
}
```

Three load-bearing details:

- **`@replace: replace`** is mandatory. Without it the rendered block *merges* with ClickHouse's
  built-in default `user_directories` (which contains `local_directory` at
  `/var/lib/clickhouse/access/`), leaving a local directory ahead of the replicated one. First
  writable directory wins for SQL-created entities, so a merged config would keep writing entities
  to node-local disk and the whole change would be inert while appearing configured. The `@`-prefix
  convention is already how this renderer expresses XML attributes in YAML
  (`clickhouse.go:18` `@remove`, `:56` `@from_file`) — **confirm `@replace` is the correct spelling
  for the attribute form in this ClickHouse version before relying on it** (see open question Q1).
- **`users_xml` must be retained**, listed first. It is what defines the `default` admin user and
  the `langwatch` user from `users.d`. Dropping it locks the operator out on restart. Keeping it
  first is also correct precedence-wise: XML-defined users stay XML-defined and are not writable,
  so writes fall through to `replicated`.
- **Path convention** aligns with the existing keeper usage (`/clickhouse/<cluster>/...`), matching
  the macros `clickhouse.go:49-53` already render.

**Step 2 — renderer: `named_collections_storage`.** Same file, replicated-only:

```go
func renderNamedCollectionsStorage(input *config.Input, configD string) error {
    return writeYAML(filepath.Join(configD, "named-collections-storage.yaml"), map[string]any{
        "named_collections_storage": map[string]any{
            "type":              "zookeeper",
            "path":              "/clickhouse/" + input.ClusterName + "/named_collections/",
            "update_timeout_ms": 5000,
        },
    })
}
```

Use the **unencrypted** `zookeeper` type, not `zookeeper_encrypted`: the encrypted variant needs a
`key_hex` the chart would have to generate, store and rotate, and the collection's Postgres password
is already a k8s Secret sitting in the same trust boundary as keeper. Set `update_timeout_ms`
explicitly at its documented default (5000) rather than omitting it — the app creates the collection
and then immediately creates engine tables referencing it, so the propagation window is on the hot
path and should be visible in config rather than implicit.

**Step 3 — renderer wiring.** In `render.go`, extend the existing replicated block:

```go
if input.Replicated {
    if err := renderKeeper(input, configD); err != nil { ... }
    if err := renderUserDirectories(input, configD); err != nil { ... }
    if err := renderNamedCollectionsStorage(input, configD); err != nil { ... }
}
```

Keep `renderAccessManagement` (`access.go:26`) unconditional and unchanged. It grants the `default`
user `access_management: 1` etc. in `users.d`, which is orthogonal to *where* entities are stored:
the permission to run the DDL is a property of the XML-defined admin user, the storage backend is a
property of the server. Same for `renderCustomSettingsPrefixes` — the `custom_` prefix must be
declared on every node regardless, and replicated storage does not carry it (it is server config,
not an access entity). **This is why both must stay unconditional**; making either replicated-only
would break single-replica, and making them conditional-on-replicated would break the profile.

**Step 4 — drop the chart gate.** `_helpers.tpl:1260`:

```
{{- define "langwatch.lwql.selfProvisionActive" -}}
{{- if .Values.lwql.enabled -}}
true
{{- end -}}
{{- end -}}
```

The helper collapses to `lwql.enabled`. Consider inlining it — but keep it: NOTES.txt and the env
block both call it, and a named helper documents the concept. Rewrite its doc comment to state the
clustered story (replicated access storage + keeper-backed collections in replicated mode; Replicated
database engine fans out the rest) instead of the exclusion.

**Step 5 — prose sweep.** Every site the inventory found:
`_helpers.tpl:854-863` (env-block comment, the "Skipped for chart-managed ClickHouse at replicas > 1"
sentence), `_helpers.tpl:1251-1252`, `NOTES.txt:322/333/340-343` (delete the whole warning branch),
`values.yaml:1974-1976`, `charts/langwatch/README.md`. Add to
`charts/clickhouse-serverless/README.md` a short replicated-mode note naming the two new files.
Leave `dev/docs/adr/084`'s "no PostgreSQL read replica" alone — that is about Postgres, unrelated.
Leave `charts/clickhouse-serverless`'s `clusterSecret`/Keeper `replicas>1` prose alone — different
subsystem.

**Step 6 — verify the database-engine assumption.** Before trusting §3a, read
`platform/app/src/server/clickhouse/migrations/00001_create_database.sql` and confirm the
`CLICKHOUSE_CLUSTER`-set branch uses `ENGINE = Replicated`, and grep `lwqlClickHouseSetupStatements`
for any `CREATE DATABASE`. If LWQL does emit one, it must become `IF NOT EXISTS` **and** the plan
gains a step to match the engine. Cheap check, do it first in implementation order.

**Step 7 — e2e.** See §6.

**Step 8 — static verification.** `helm template` at `replicas=3` with `values-e2e.yaml` and grep
for `LWQL_SELF_PROVISION` — must now be `1` where it is currently `0` (measured this session:
`replicas=1` → 1 hit, `replicas=3` → 0 hits). `go test ./internal/render/...` and
`golangci-lint run ./infra/...`. No test suites otherwise; CI runs them.

## 6. e2e strategy

**Do not add a third kind leg.** The `e2e` matrix's two legs are already the most expensive jobs in
the repo (`infra` 697s, `overlays` 348s — stated in `.github/workflows/langwatch-chart.yml:66,240`).
A third full leg that installs the whole stack again is the wrong trade.

Instead, three-tier it:

- **Template tier (free)** — extend `e2e-overlays.sh` beside the existing `CLICKHOUSE_CLUSTER`
  assertion (~line 983): assert `LWQL_SELF_PROVISION` **is** present at `replicas=3`. This is the
  direct regression guard on the gate removal and costs nothing.
- **Renderer tier (free)** — `render_test.go`: assert both files exist with the right content in
  replicated mode, and assert **neither** exists in standalone mode. Also assert `user_directories`
  carries the replace attribute and still lists `users_xml` — that is the inert-config trap from
  Step 1, and it is only catchable here.
- **Live tier (the real cost)** — the honest question is whether `charts/langwatch`'s `infra` leg
  can run its ClickHouse at 3 replicas. It cannot cheaply: kind with 3 CH replicas + 3 keeper pods
  is a large step up in a job already at 697s.

  **Recommendation: put the live clustered LWQL assertions in
  `charts/clickhouse-serverless/tests/` instead**, which already has `values-replicated.yaml`
  (replicas 3) and a replicated leg with keeper running. Assert there, at the *server* level, the
  properties that actually need a cluster: create a user + a named collection through one pod, then
  read them back from **each** pod by `kubectl exec` (not through the Service). That proves
  replication of exactly the two per-node things, without booting the whole LangWatch app.

  The app-level assertions (tenant isolation, idempotence) stay in `charts/langwatch`'s existing
  single-replica `test_lwql` where they already are, because they are not topology-dependent.

  This splits the ACs cleanly: "do access entities and collections replicate" is a
  clickhouse-serverless property; "does LWQL provision correctly" is a langwatch-chart property.

- **Scale-up scenario**: worth an AC, not worth an e2e. A 1→3 scale-up in CI means an install, a
  helm upgrade, and waiting for 2 new replicas plus keeper — expensive and slow. Cover it as
  documented behavior (§7) and a `@unit`-level assertion that the renderer's output differs between
  modes.

Refactor `test_lwql` to take the pod list as a parameter so the per-pod assertion shape exists even
though `charts/langwatch` invokes it with one pod. Cheap, and it is what makes a future clustered
leg a one-line call.

## 7. The scale-up / migration story — be explicit

An install at `replicas=1` runs **standalone** renderer mode: no keeper, local access storage,
entities on the app-pod's ClickHouse disk. Scaling to `replicas=3` flips the renderer to replicated
mode, and keeper starts empty — the existing entities are in local storage and are **not** migrated.

What converges it: `provisionLwql` re-runs on every app boot and every generator is
`CREATE OR REPLACE` / `IF NOT EXISTS` (`provisionLwql.ts` header states this; `selfProvisioning.ts:274-284`
confirms the drop-and-recreate for engine tables). So a **restart of the app pod after the scale-up**
re-creates the whole model, this time landing in keeper-backed storage.

But that restart is **not automatic** — a `helm upgrade` changing `clickhouse.replicas` rolls the
ClickHouse StatefulSet, not necessarily the app Deployment. So:

- **Handled**: steady-state at any replica count; scale-up *after* an app restart; new replicas
  joining an already-keeper-backed cluster (they read keeper on start, self-heal).
- **Documented as requiring an app restart**: the 1→N transition itself. NOTES.txt must say so, in
  the branch where `replicas > 1` — replacing the warning being deleted, not leaving a gap. Wording
  should be actionable: `kubectl rollout restart deploy/<release>-app`.
- **Stale local entities**: the old node-local `langwatch_lwql` on replica-0 is shadowed, not
  deleted. Harmless (same name, same password, replicated one wins by directory precedence) but
  worth one sentence so an operator reading `system.users` on replica-0 is not confused. **Confirm
  precedence direction empirically** — see Q2.

## 8. Risks

1. **`@replace` attribute spelling / YAML-config support** — if the renderer's YAML form cannot
   express the `replace="replace"` attribute, the config merges and the change is silently inert
   (looks configured, entities still node-local). *This is the single highest-risk item.* Mitigated
   by the renderer unit test asserting the attribute, and by an e2e that reads an entity back from a
   *different* pod than the one that created it. Fallback if unsupported: drop the file as XML
   instead of YAML — ClickHouse accepts both in `config.d`, and `writeYAML` would become
   `writeXML` for this one file.
2. **Not a one-way door, with one exception**: switching `named_collections_storage` backends
   "requires a server restart; `SYSTEM RELOAD CONFIG` does not change the active backend" (CH docs).
   Existing local collections are not migrated. On a fresh clustered install this is a non-issue; on
   an existing clustered install the app restart in §7 recreates the collection. Call it out.
3. **Image release coupling** — chart-managed clustered LWQL will not work until an image past
   0.3.0 ships (#7349). The gate removal makes the chart *promise* the feature at replicas>1
   immediately. If #7349 slips, a clustered operator on tag 0.3.0 gets a fail-closed LWQL rather
   than a skipped one. Acceptable (fail-closed is the designed degradation) but must be stated, and
   argues for landing #7349 first.
4. **Known historical bug**: CH failed to start with both an embedded `keeper_server` and a
   replicated user directory (issue #33973, early 2022, fixed since). The chart runs keeper as a
   *separate* StatefulSet, not embedded, so it does not apply — but if anyone later moves to
   embedded keeper this resurfaces.
5. **Blast radius of `user_directories`** — a malformed file prevents server start on *every* node,
   including deployments that never asked for LWQL. Gated on `input.Replicated`, so single-replica
   installs are untouched; the replicated leg in clickhouse-serverless e2e is what proves it boots.

## 9. AC draft

<!-- ACs ready for ac-reviewer -->

Convention checked: `specs/**/*.feature`, Gherkin, tags `@unit` / `@integration` / `@e2e`. Every
scenario needs a binding tag **and** a `@scenario "<title>"` annotation on the covering test, or
`check-feature-parity.ts` reports it vacuously bound.

Target file: `specs/analytics/lwql-api.feature` (app-level) and a new
`specs/clickhouse/replicated-access-storage.feature` (server-level).

```gherkin
# specs/clickhouse/replicated-access-storage.feature
Feature: Clustered ClickHouse replicates the LangWatchQL access model

  @unit
  Scenario: Replicated mode configures keeper-backed access storage
    Given the ClickHouse config renderer runs in replicated mode
    When it writes the server configuration
    Then the access-entity storage is keeper-backed
    And the XML-defined users remain readable

  @unit
  Scenario: Replicated access storage takes precedence over node-local storage
    Given the ClickHouse config renderer runs in replicated mode
    When it writes the access-entity storage configuration
    Then the configuration replaces the server's default storage rather than merging with it

  @unit
  Scenario: Replicated mode configures keeper-backed named collections
    Given the ClickHouse config renderer runs in replicated mode
    When it writes the server configuration
    Then named collections are stored in keeper with an explicit propagation timeout

  @unit
  Scenario: Standalone mode configures neither
    Given the ClickHouse config renderer runs in standalone mode
    When it writes the server configuration
    Then no keeper-backed access or named-collection storage is configured

  @unit
  Scenario: Access management stays enabled in both modes
    Given the ClickHouse config renderer runs in either mode
    When it writes the server configuration
    Then the admin user can create access entities and named collections through SQL
    And the custom settings prefix is declared

  @e2e
  Scenario: An access entity created on one replica is visible on every replica
    Given a clustered ClickHouse with three replicas
    When an access entity is created through one replica
    Then every other replica reports the same entity

  @e2e
  Scenario: A named collection created on one replica is visible on every replica
    Given a clustered ClickHouse with three replicas
    When a named collection is created through one replica
    Then every other replica reports the same collection
```

```gherkin
# additions to specs/analytics/lwql-api.feature
  @e2e
  Scenario: Clustered chart-managed ClickHouse provisions LangWatchQL
    Given the chart is installed with chart-managed ClickHouse at more than one replica
    When the application boots
    Then LangWatchQL self-provisioning is wired into the application

  @e2e
  Scenario: The provisioned identity is restricted on every replica
    Given LangWatchQL is provisioned against a clustered ClickHouse
    When the restricted identity queries the access catalog on any replica
    Then it is denied

  @e2e
  Scenario: Tenant isolation holds through the load-balanced endpoint
    Given LangWatchQL is provisioned against a clustered ClickHouse
    And two tenants have distinct key-map rows
    When a tenant queries through the load-balanced service
    Then it reads only its own rows
    And repeating the query reads only its own rows

  @e2e
  Scenario: Re-provisioning a clustered deployment converges
    Given LangWatchQL is provisioned against a clustered ClickHouse
    When provisioning runs a second time
    Then the restricted identity exists exactly once on every replica
    And no key-map rows are duplicated

  @integration
  Scenario: Provisioning does not create the database ahead of the migrations
    Given the ClickHouse migrations have created the application database
    When LangWatchQL provisioning runs
    Then it does not alter the database's engine

  @unit
  Scenario: A replica added after provisioning serves LangWatchQL
    Given LangWatchQL was provisioned against a clustered ClickHouse
    When a further replica joins the cluster
    Then it reports the provisioned identity without re-running provisioning
```

Deliberately covered failure/edge surface: the inert-merge trap (scenario 2 — the highest-risk
item), the standalone-untouched case, the both-modes invariant, the scale-out case, and the
engine-collision case. The 1→N *migration* is documented behavior, not an AC — see Q3.

## 10. Open questions for the owner

1. **Q1 — `@replace` attribute in the YAML renderer.** The `user_directories` block needs XML's
   `replace="replace"`; the renderer expresses attributes as `@remove` / `@from_file`. If ClickHouse's
   YAML dialect does not accept `@replace`, do you want this one file emitted as XML instead? *(My
   default: yes, emit XML for this file — correctness over uniformity, and the risk of a silently
   inert merge is the worst outcome here.)*
2. **Q2 — precedence when a stale node-local entity shares a name with a replicated one.** I expect
   directory order to decide (users_xml, then replicated; local_directory removed by the replace), so
   the stale entity is simply gone from the lookup path. Worth an empirical check during
   implementation rather than an owner decision — flagging only because §7's operator wording
   depends on it.
3. **Q3 — is 1→N scale-up "documented restart" acceptable, or must it self-heal?** Making it
   automatic means the chart triggering an app rollout on a ClickHouse replica-count change (a
   checksum annotation), which is doable but widens the diff. *My recommendation: document it now,
   file a follow-up.*
4. **Q4 — should #7349 (image release past 0.3.0) land first?** Risk 3 says a clustered operator on
   0.3.0 gets fail-closed LWQL. *My recommendation: land #7349 first, but do not block this work on
   it.*

## Handoff

- ACs ready for ac-reviewer (see §9 AC draft above).
- Implementation → coder. Steps 1-3 (Go renderer) and step 6 (verification) carry design judgment;
  steps 4-5 (gate removal + prose sweep) are mechanical and could go to fast-coder with the
  inventory in §4 as the exact site list.
