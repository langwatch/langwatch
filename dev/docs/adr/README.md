# Architecture Decision Records (ADRs)

Document **important technical and architectural decisions** — context, trade-offs, and consequences.

## Numbering rule

**A new ADR takes the next number above the current maximum in this directory — never a gap, never a number that "looks free".**

Run `ls dev/docs/adr | grep -oE '^[0-9]{3}' | sort -n | tail -1`, add one, and use that. Gaps in the sequence are deliberate: a number that was ever issued stays retired, because "ADR-0NN" appears in code comments, specs and other ADRs, and reusing it makes every one of those references ambiguous. Two documents sharing a number is a defect — `ls dev/docs/adr | grep -oE '^[0-9]{3}' | sort | uniq -d` must print nothing.

The file name is `NNN-short-title.md` and the `# ADR-NNN:` heading inside must match it.

`dev/docs/adr/` is the **only** ADR directory. The series lived at `docs/adr/` until 2026-03-25 and was moved here; `docs/` is now the customer documentation site and holds no ADRs. A stray ADR written there is a second series with its own numbers, which is how "ADR-014" once named two documents — put new ones here.

## Decisions

| # | Decision | Status |
| --- | --- | --- |
| [001](./001-rbac.md) | RBAC with Organization → Team → Project hierarchy | Accepted |
| [003](./003-logging.md) | Logging and tracing infrastructure | Accepted |
| [004](./004-docker-dev-environment.md) | Docker Compose development environment | Accepted |
| [005](./005-feature-flags.md) | Feature flags (registry, Postgres, PostHog) | Accepted |
| [008](./008-extensible-metadata-on-scenario-events.md) | Extensible metadata on scenario events | Accepted |
| [009](./009-otel-trace-context-propagation-for-http-scenarios.md) | OTel trace-context propagation for HTTP scenario targets | Accepted |
| [010](./010-e2e-testing-strategy.md) | E2E testing strategy — browser verification over generated tests | Accepted |
| [011](./011-internal-set-id-naming-convention.md) | Internal set-ID naming convention | Accepted |
| [012](./012-skills-information-architecture.md) | Skills information architecture and feature map | Accepted |
| [013](./013-workflow-based-onboarding.md) | Workflow-based onboarding with skills and recipes | Accepted |
| [016](./016-scoped-model-providers.md) | Scoped model providers & default models | Accepted |
| [017](./017-gateway-trace-payload-capture.md) | Gateway trace payload capture | Accepted |
| [018](./018-governance-unified-observability-substrate.md) | Governance ingestion uses the unified observability substrate | Accepted |
| [019](./019-repository-service-layering.md) | Repository-service layering for project configuration access | Accepted |
| [020](./020-cascading-default-models.md) | Cascading default models with one policy attached to N scopes | Accepted |
| [021](./021-multi-scope-targeting-and-tenancy.md) | Multi-scope targeting and single-organization tenancy enforcement | Accepted |
| [027](./027-typed-dispatcherror-contract.md) | Typed `DispatchError` contract for dispatch endpoints | Accepted |
| [028](./028-visibility-blur-teaser-redaction.md) | Plan-based visibility windows via stateless service-layer teaser redaction | Proposed |
| [031](./031-trigger-email-abuse-protections.md) | Trigger email abuse protections — test-fire lockdown, hourly cap, unsubscribe | Accepted |
| [032](./032-datasets-s3-jsonl.md) | Dataset content moves to S3 as chunked JSONL | Accepted |
| [033](./033-langy-worker-network-isolation-under-gvisor.md) | Langy worker network isolation under gVisor | Draft |
| [036](./036-liquid-templates-for-trigger-notifications.md) | Liquid templates for user-customizable trigger notifications | Accepted |
| [037](./037-automation-operator-surfaces.md) | Automation operator surfaces — authoring drawer & dispatch-health view | Accepted |
| [038](./038-intent-forked-onboarding-governance-vs-llmops.md) | Onboarding forks on a first-class Organization intent | Accepted |
| [040](./040-webhook-http-request-automation-channel.md) | Webhook (generic HTTP request) automation channel | Proposed |
| [041](./041-modern-block-kit-notification-template-suite.md) | Modern Block Kit notification template suite | Proposed |
| [042](./042-local-observability-stack.md) | Local observability stack (logs, traces, metrics → Grafana) | Accepted |
| [043](./043-automation-facet-model.md) | Automations as orthogonal facets (name / type / subject / cadence / severity / delivery) | Proposed |
| [044](./044-scheduled-reports-automation-kind.md) | Scheduled reports — a schedule-triggered automation kind | Proposed |
| [045](./045-domain-errors-handled-boundary.md) | Handled errors as the handled-error boundary (TS `HandledError` ⇔ Go `herr`) | Accepted |
| [047](./047-langy-foundations.md) | Langy foundations — hexagonal Go service, caller-scoped sessions | Accepted |
| [050](./050-langy-versioned-prompts-and-dogfood-evals.md) | Langy's prompts in the versioned prompt registry + dogfood scenarios/evals | Proposed |
| [053](./053-tenant-aware-egress-and-workload-isolation.md) | Tenant-aware egress and per-workload sandbox isolation | Proposed |
| [054](./054-observability-as-code-for-the-process-substrate.md) | Observability-as-code for the process-manager substrate | Accepted |
| [055](./055-canonical-otlp-metric-and-log-pipelines.md) | Canonical OTLP metric and log pipelines | Proposed |
| [057](./057-token-gated-trace-sharing.md) | Token-gated trace sharing (ShareLink) | Accepted |
| [058](./058-full-stack-trace-correlation-browser-rum.md) | Full-stack trace correlation — browser RUM into the internal stack | Draft |
| [060](./060-langy-model-emitted-blocks.md) | The model's in-stream data channel — derived cards and choice questions | Accepted |
| [061](./061-langy-trace-dual-export.md) | Langy turns export twice — the customer's trace, and ours | Accepted |
| [064](./064-haven-cli-redesign.md) | haven CLI v2 — one name per command, one meaning per flag | Proposed |
| [076](./076-langy-egress-enforcement.md) | Langy egress enforcement — monitor first, enforce last | Accepted |
| [077](./077-langy-dual-stream.md) | Langy dual-stream — raw token fast-path alongside the durable event-sourced stream | Accepted |
| [078](./078-langy-user-turn-controls.md) | Langy user-initiated turn controls — stop for real, continue, resume-on-refresh | Accepted |
| [079](./079-card-selection-is-deterministic.md) | Card selection is deterministic — the model supplies data, never presentation | Accepted |
| [086](./086-prompt-labels-data-model.md) | Prompt labels data model | Accepted (revised) |
| [087](./087-form-validation-and-save.md) | Form validation and Save button behavior | Accepted |
| [089](./089-data-retention.md) | Per-tenant per-category data retention enforced by ClickHouse-native TTL | Accepted |
| [092](./092-trace-drawer-code-highlighting.md) | Trace drawer code highlighting — lazy on-demand Shiki language loading | Accepted |
| [093](./093-trace-facet-sidebar-presentation-and-perspectives.md) | Trace facet sidebar — numeric presentation modes and facet perspectives | Proposed |
| [094](./094-trace-table-per-evaluator-columns.md) | Trace table per-evaluator eval columns | Proposed |
| [097](./097-depth-aware-overlay-z-index.md) | Depth-aware z-index for portalled overlay components | Accepted |
| [098](./098-event-sourcing-core.md) | The event-sourcing core — commands, events, and the two kinds of projection | Accepted |
| [099](./099-projection-storage-and-table-definition.md) | Projection storage — three store kinds and one table definition | Accepted |
| [100](./100-dispatch-plane-group-keys.md) | The dispatch plane — a group key is a declared contract, not a string | Accepted |
| [101](./101-replay-offline-version-gated.md) | Replay is offline, version-gated, and the only bulk reader of `event_log` | Accepted |
| [102](./102-package-topology-and-composition.md) | The core is a package, the pipelines are the application | Accepted |
| [103](./103-runs-aggregates-are-queries.md) | A run's totals are a query; a run's liveness is a process manager | Accepted |
| [104](./104-clickhouse-client.md) | One ClickHouse client, and the schema decides whether a write may be retried | Accepted |
| [105](./105-defining-an-aggregate.md) | An aggregate is one declaration — events, commands and types are derived from it | Accepted |

39 numbers (002, 006, 007, 014, 015, 022, 023, 024, 026, 029, 030, 034, 035,
039, 046, 048, 049, 051, 052, 056, 059, 066, 068, 069, 071–075, 080–085, 088,
090, 091, 095) were retired in one commit that replaced the whole
event-sourcing corpus with 098–105. They are **not relisted above** — see
[Retired ADR Numbers](#retired-adr-numbers) for where each one's ground now
lives.

Two more — 025 and 096 — were retired separately on 2026-07-30: each had
rotted into a duplicate of ground an ADR in the 098–105 series already
covered, so each was absorbed as a section of that ADR (089 and 098
respectively) rather than replaced by a corpus-wide renumbering. Same rule —
not relisted above — and they share the table below.

## Retired ADR Numbers

39 ADRs described the event-sourcing substrate piecemeal, and by 2026-07-29 no
longer described one coherent design — several carried a superseded half as an
inline amendment, so reading one meant deciding which paragraphs still
applied. A single commit deleted all 39 and replaced them with seven ADRs
presenting the target shape only (098–104); an eighth, 105, followed shortly
after for aggregate declaration. Their files are gone from this directory, but
the numbers are not reusable (see "Numbering rule" above) and still appear in
code comments, specs, and — critically — in **deployed ClickHouse migrations**,
which are immutable history and can never be edited to point elsewhere. This
table is the resolution for any of those stray citations.

Two further rows, 025 and 096, were added to this same table on 2026-07-30 for
a different reason: not a corpus-wide replacement, but each having rotted into
a standalone document describing ground an ADR in the 098–105 series already
covered — 025's PG-orphan-sweep removal duplicated 089's retention story, and
096's evaluation-inputs offload duplicated 098's durable-reference decision.
Both were absorbed as sections of the ADR they duplicated and deleted.

| Old # | Title | Ground now owned by |
| --- | --- | --- |
| 002 | Event sourcing for traces and evaluations | [098](./098-event-sourcing-core.md) |
| 006 | Redis cluster hash tags for BullMQ queue names | [100](./100-dispatch-plane-group-keys.md) |
| 007 | Event sourcing architecture (fold/map projections) | [098](./098-event-sourcing-core.md) |
| 014 | Remove the BullMQ dependency and queue browser from Skynet | [100](./100-dispatch-plane-group-keys.md) |
| 015 | Projection replay coordination protocol | [101](./101-replay-offline-version-gated.md) |
| 022 | `event_log` as single source of truth · S3 as transient spool only | [099](./099-projection-storage-and-table-definition.md) |
| 023 | Reactor-seeded self-perpetuating chain for retention orphan sweep | [089](./089-data-retention.md) — the sweep was removed entirely, not replaced (via 025, itself absorbed into 089 on 2026-07-30) |
| 024 | Cold-path tiered storage for retention-managed tables | [099](./099-projection-storage-and-table-definition.md) |
| 025 | Remove the PG orphan sweep entirely | [089](./089-data-retention.md) — absorbed as the "Orphan sweep: added, then removed" section |
| 026 | Per-trigger dispatch timing — cadence and trace-readiness debounce | [098](./098-event-sourcing-core.md) |
| 029 | GroupQueue content-addressed tiered payload store | [100](./100-dispatch-plane-group-keys.md) |
| 030 | GroupQueue blob-handling hardening | [100](./100-dispatch-plane-group-keys.md) |
| 034 | Event-sourced analytics materialization — slim + rollup ClickHouse tables | [099](./099-projection-storage-and-table-definition.md) |
| 035 | Persist-class actions ride the settle stage (trace-readiness debounce) | [098](./098-event-sourcing-core.md) |
| 039 | Outbox heartbeat primitive | [098](./098-event-sourcing-core.md) |
| 046 | Event-sourced Langy conversations | [098](./098-event-sourcing-core.md) |
| 048 | Langy worker shutdown-handoff — checkpoint on SIGTERM, resume on the next worker | [098](./098-event-sourcing-core.md) |
| 049 | Langy pilots Postgres operational state and projection-independent reactions | [099](./099-projection-storage-and-table-definition.md) |
| 051 | Event-sourced topic clustering scheduling via the process manager | [098](./098-event-sourcing-core.md) |
| 052 | Automations on a dedicated process-manager pipeline | [098](./098-event-sourcing-core.md) |
| 056 | Coding-agent pipeline with a session aggregate | [105](./105-defining-an-aggregate.md) |
| 059 | Event-sourced Langy frontend — shared projections in `packages/langy` | [098](./098-event-sourcing-core.md) |
| 066 | `event_log` off the per-item hot path — read-back fold store + append coalescing | [099](./099-projection-storage-and-table-definition.md) |
| 068 | One windowed ClickHouse read with a measured fallback (`queryWindowed`) | [104](./104-clickhouse-client.md) |
| 069 | Payload cost is a scheduling input — extraction at ingest, byte bounds, memory by grant | [098](./098-event-sourcing-core.md) |
| 071 | A storage anchor is immutable and platform-assigned | [099](./099-projection-storage-and-table-definition.md) |
| 072 | Run aggregates are queries, not pipelines | [103](./103-runs-aggregates-are-queries.md) |
| 073 | Run execution on the process-manager substrate | [103](./103-runs-aggregates-are-queries.md) |
| 074 | Package topology for the server codebase | [102](./102-package-topology-and-composition.md) |
| 075 | Post-event work is subscribers and process managers — the reactor is retired | [098](./098-event-sourcing-core.md) |
| 080 | A staged job id is an identity, not a place to keep state | [100](./100-dispatch-plane-group-keys.md) |
| 081 | The unit of dispatched work — derived identity, and what may be leased | [098](./098-event-sourcing-core.md) |
| 082 | A pipeline is defined in its own file, in layers | [102](./102-package-topology-and-composition.md) |
| 083 | `stored_spans` elects the wrong version — fix the readers now, re-key the table later | [099](./099-projection-storage-and-table-definition.md) |
| 084 | Single entry point worker architecture | [102](./102-package-topology-and-composition.md) |
| 085 | Scenario orphaned-run reconciliation | [103](./103-runs-aggregates-are-queries.md) |
| 088 | Lean fold cache | [099](./099-projection-storage-and-table-definition.md) |
| 090 | GroupQueue payload envelope — opaque compressed payloads with a routing header | [100](./100-dispatch-plane-group-keys.md) |
| 091 | Pure `shouldReact` predicate gates reactor enqueue | [098](./098-event-sourcing-core.md) |
| 095 | Transactional outbox for stake-sensitive reactor dispatch | [098](./098-event-sourcing-core.md) |
| 096 | Durable stored-object offload for evaluation inputs | [098](./098-event-sourcing-core.md) — absorbed into decision 8 (durable references) |

Note on 023: it is the one retirement that does not land on 098–105 directly.
Its mechanism (a reactor-seeded chain) was superseded in-tree by ADR-025,
which removed the orphan sweep outright rather than redesigning it. 025
predated and survived the 098–105 replacement untouched, but was itself
absorbed into 089 on 2026-07-30 as that ADR's orphan-cleanup section — so
023's ground now runs through 025 to 089.

## When to Write an ADR

- Long-lasting or hard to reverse
- Affects multiple teams/services
- Tools, frameworks, data models, protocols, patterns
- Impacts costs, performance, or maintainability

Skip for small implementation details or experiments.

## How to Write

1. **One decision per ADR** — keep it focused
2. **Keep it short** — 1-2 pages max
3. **Write for the future** — assume someone reads this in 2 years
4. **Be honest about trade-offs** — no decision is perfect
5. **Use narrative** — explain reasoning, not just bullet points

Use [`TEMPLATE.md`](./TEMPLATE.md) for new ADRs. Name: `NNN-short-title.md`

## Status

- **Draft** → initial write-up
- **Proposed** → under discussion
- **Accepted** → in effect
- **Superseded** → replaced by later ADR
- **Deprecated** → no longer relevant
