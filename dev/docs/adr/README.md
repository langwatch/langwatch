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
| [002](./002-event-sourcing.md) | Event sourcing for traces and evaluations | Superseded by [007](./007-event-sourcing-architecture.md) |
| [003](./003-logging.md) | Logging and tracing infrastructure | Accepted |
| [004](./004-docker-dev-environment.md) | Docker Compose development environment | Accepted |
| [005](./005-feature-flags.md) | Feature flags (registry, Postgres, PostHog) | Accepted |
| [006](./006-redis-cluster-bullmq-hash-tags.md) | Redis cluster hash tags for BullMQ queue names | Accepted |
| [007](./007-event-sourcing-architecture.md) | Event sourcing architecture (fold/map projections) | Accepted |
| [008](./008-extensible-metadata-on-scenario-events.md) | Extensible metadata on scenario events | Accepted |
| [009](./009-otel-trace-context-propagation-for-http-scenarios.md) | OTel trace-context propagation for HTTP scenario targets | Accepted |
| [010](./010-e2e-testing-strategy.md) | E2E testing strategy — browser verification over generated tests | Accepted |
| [011](./011-internal-set-id-naming-convention.md) | Internal set-ID naming convention | Accepted |
| [012](./012-skills-information-architecture.md) | Skills information architecture and feature map | Accepted |
| [013](./013-workflow-based-onboarding.md) | Workflow-based onboarding with skills and recipes | Accepted |
| [014](./014-skynet-bullmq-removal.md) | Remove the BullMQ dependency and queue browser from Skynet | Accepted |
| [015](./015-projection-replay-coordination.md) | Projection replay coordination protocol | Accepted |
| [016](./016-scoped-model-providers.md) | Scoped model providers & default models | Accepted |
| [017](./017-gateway-trace-payload-capture.md) | Gateway trace payload capture | Accepted |
| [018](./018-governance-unified-observability-substrate.md) | Governance ingestion uses the unified observability substrate | Accepted |
| [019](./019-repository-service-layering.md) | Repository-service layering for project configuration access | Accepted |
| [020](./020-cascading-default-models.md) | Cascading default models with one policy attached to N scopes | Accepted |
| [021](./021-multi-scope-targeting-and-tenancy.md) | Multi-scope targeting and single-organization tenancy enforcement | Accepted |
| [022](./022-event-log-source-of-truth.md) | `event_log` as single source of truth · S3 as transient spool only | Proposed |
| [023](./023-orphan-sweep-reactor-chain.md) | Reactor-seeded self-perpetuating chain for retention orphan sweep | Superseded by [025](./025-remove-orphan-sweep.md) |
| [024](./024-cold-path-tiered-storage.md) | Cold-path tiered storage for retention-managed tables | Accepted |
| [025](./025-remove-orphan-sweep.md) | Remove the PG orphan sweep entirely | Accepted |
| [026](./026-per-trigger-dispatch-timing.md) | Per-trigger dispatch timing — cadence and trace-readiness debounce | Accepted, amended by [052](./052-automations-on-process-manager-substrate.md) |
| [027](./027-typed-dispatcherror-contract.md) | Typed `DispatchError` contract for dispatch endpoints | Accepted |
| [028](./028-visibility-blur-teaser-redaction.md) | Plan-based visibility windows via stateless service-layer teaser redaction | Proposed |
| [029](./029-groupqueue-content-addressed-payload-store.md) | GroupQueue content-addressed tiered payload store | Accepted |
| [030](./030-groupqueue-blob-handling-hardening.md) | GroupQueue blob-handling hardening | Proposed |
| [031](./031-trigger-email-abuse-protections.md) | Trigger email abuse protections — test-fire lockdown, hourly cap, unsubscribe | Accepted |
| [032](./032-datasets-s3-jsonl.md) | Dataset content moves to S3 as chunked JSONL | Accepted |
| [033](./033-langy-worker-network-isolation-under-gvisor.md) | Langy worker network isolation under gVisor | Draft |
| [034](./034-event-sourced-analytics-materialization.md) | Event-sourced analytics materialization — slim + rollup ClickHouse tables | Accepted |
| [035](./035-persist-class-debounce.md) | Persist-class actions ride the settle stage (trace-readiness debounce) | Accepted |
| [036](./036-liquid-templates-for-trigger-notifications.md) | Liquid templates for user-customizable trigger notifications | Accepted |
| [037](./037-automation-operator-surfaces.md) | Automation operator surfaces — authoring drawer & dispatch-health view | Accepted |
| [038](./038-intent-forked-onboarding-governance-vs-llmops.md) | Onboarding forks on a first-class Organization intent | Accepted |
| [039](./039-outbox-heartbeat.md) | Outbox heartbeat primitive | Superseded by [052](./052-automations-on-process-manager-substrate.md) |
| [040](./040-webhook-http-request-automation-channel.md) | Webhook (generic HTTP request) automation channel | Proposed |
| [041](./041-modern-block-kit-notification-template-suite.md) | Modern Block Kit notification template suite | Proposed |
| [042](./042-local-observability-stack.md) | Local observability stack (logs, traces, metrics → Grafana) | Accepted |
| [043](./043-automation-facet-model.md) | Automations as orthogonal facets (name / type / subject / cadence / severity / delivery) | Proposed |
| [044](./044-scheduled-reports-automation-kind.md) | Scheduled reports — a schedule-triggered automation kind | Proposed |
| [045](./045-domain-errors-handled-boundary.md) | Handled errors as the handled-error boundary (TS `HandledError` ⇔ Go `herr`) | Accepted |
| [046](./046-event-sourced-langy-conversations.md) | Event-sourced Langy conversations | Superseded in part by [049](./049-langy-projection-independent-reactions.md) |
| [047](./047-langy-foundations.md) | Langy foundations — hexagonal Go service, caller-scoped sessions | Accepted |
| [048](./048-langy-shutdown-handoff.md) | Langy worker shutdown-handoff — checkpoint on SIGTERM, resume on the next worker | Proposed |
| [049](./049-langy-projection-independent-reactions.md) | Langy pilots Postgres operational state and projection-independent reactions | Accepted |
| [050](./050-langy-versioned-prompts-and-dogfood-evals.md) | Langy's prompts in the versioned prompt registry + dogfood scenarios/evals | Proposed |
| [051](./051-event-sourced-topic-clustering.md) | Event-sourced topic clustering scheduling via the process manager | Accepted |
| [052](./052-automations-on-process-manager-substrate.md) | Automations on a dedicated process-manager pipeline | Accepted |
| [053](./053-tenant-aware-egress-and-workload-isolation.md) | Tenant-aware egress and per-workload sandbox isolation | Proposed |
| [054](./054-observability-as-code-for-the-process-substrate.md) | Observability-as-code for the process-manager substrate | Accepted |
| [055](./055-canonical-otlp-metric-and-log-pipelines.md) | Canonical OTLP metric and log pipelines | Proposed |
| [056](./056-coding-agent-pipeline-session-aggregate.md) | Coding-agent pipeline with a session aggregate | Proposed |
| [057](./057-token-gated-trace-sharing.md) | Token-gated trace sharing (ShareLink) | Accepted |
| [058](./058-full-stack-trace-correlation-browser-rum.md) | Full-stack trace correlation — browser RUM into the internal stack | Draft |
| [059](./059-event-sourced-langy-frontend.md) | Event-sourced Langy frontend — shared projections in `packages/langy` | Accepted |
| [060](./060-langy-model-emitted-blocks.md) | The model's in-stream data channel — derived cards and choice questions | Accepted |
| [061](./061-langy-trace-dual-export.md) | Langy turns export twice — the customer's trace, and ours | Accepted |
| [064](./064-haven-cli-redesign.md) | haven CLI v2 — one name per command, one meaning per flag | Proposed |
| [066](./066-projection-clickhouse-cached-store.md) | `event_log` off the per-item hot path — read-back fold store + append coalescing | Accepted |
| [068](./068-windowed-clickhouse-reads.md) | One windowed ClickHouse read with a measured fallback (`queryWindowed`) | Accepted |
| [069](./069-payload-cost-doctrine.md) | Payload cost is a scheduling input — extraction at ingest, byte bounds, memory by grant | Accepted |
| [071](./071-coding-agent-session-immutable-storage-anchor.md) | A storage anchor is immutable and platform-assigned | Accepted |
| [072](./072-run-aggregates-are-queries.md) | Run aggregates are queries, not pipelines | Accepted |
| [073](./073-run-execution-on-process-manager.md) | Run execution on the process-manager substrate | Accepted |
| [074](./074-package-topology.md) | Package topology for the server codebase | Proposed |
| [075](./075-post-event-work-subscribers-and-process-managers.md) | Post-event work is subscribers and process managers — the reactor is retired | Accepted |
| [076](./076-langy-egress-enforcement.md) | Langy egress enforcement — monitor first, enforce last | Accepted |
| [077](./077-langy-dual-stream.md) | Langy dual-stream — raw token fast-path alongside the durable event-sourced stream | Accepted |
| [078](./078-langy-user-turn-controls.md) | Langy user-initiated turn controls — stop for real, continue, resume-on-refresh | Accepted |
| [079](./079-card-selection-is-deterministic.md) | Card selection is deterministic — the model supplies data, never presentation | Accepted |
| [080](./080-staged-job-id-is-identity-not-state.md) | A staged job id is an identity, not a place to keep state | Accepted |
| [081](./081-the-unit-of-dispatched-work.md) | The unit of dispatched work — derived identity, and what may be leased | Accepted (partly built) |
| [082](./082-pipelines-own-their-composition.md) | A pipeline is defined in its own file, in layers | Accepted |
| [083](./083-stored-spans-version-column.md) | `stored_spans` elects the wrong version — fix the readers now, re-key the table later | Accepted |
| [084](./084-worker-architecture.md) | Single entry point worker architecture | Accepted |
| [085](./085-scenario-orphaned-run-reconciliation.md) | Scenario orphaned-run reconciliation | Superseded by [073](./073-run-execution-on-process-manager.md) |
| [086](./086-prompt-labels-data-model.md) | Prompt labels data model | Accepted (revised) |
| [087](./087-form-validation-and-save.md) | Form validation and Save button behavior | Accepted |
| [088](./088-lean-fold-cache.md) | Lean fold cache | Superseded by [066](./066-projection-clickhouse-cached-store.md) / [022](./022-event-log-source-of-truth.md) |
| [089](./089-data-retention.md) | Per-tenant per-category data retention enforced by ClickHouse-native TTL | Accepted |
| [090](./090-groupqueue-payload-envelope.md) | GroupQueue payload envelope — opaque compressed payloads with a routing header | Accepted |
| [091](./091-reactor-should-react-predicate.md) | Pure `shouldReact` predicate gates reactor enqueue | Superseded by [075](./075-post-event-work-subscribers-and-process-managers.md) |
| [092](./092-trace-drawer-code-highlighting.md) | Trace drawer code highlighting — lazy on-demand Shiki language loading | Accepted |
| [093](./093-trace-facet-sidebar-presentation-and-perspectives.md) | Trace facet sidebar — numeric presentation modes and facet perspectives | Proposed |
| [094](./094-trace-table-per-evaluator-columns.md) | Trace table per-evaluator eval columns | Proposed |
| [095](./095-transactional-outbox-for-stake-sensitive-dispatch.md) | Transactional outbox for stake-sensitive reactor dispatch | Superseded by [052](./052-automations-on-process-manager-substrate.md) |
| [096](./096-durable-stored-object-offload-for-evaluation-inputs.md) | Durable stored-object offload for evaluation inputs | Proposed |
| [097](./097-depth-aware-overlay-z-index.md) | Depth-aware z-index for portalled overlay components | Accepted |

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
