# Automation

Automation is the singular feature for trigger definitions, trigger-fire
history, report schedules, delivery policy, and project email suppression.

- `contract/` owns portable Zod 4 schemas, trigger/provider vocabulary,
  templating, report and graph-alert policy, and the abstract `AutomationService`.
- `server/` owns the concrete service, private repositories, schedule ports,
  and webhook delivery records. It also owns the reusable persist-cap runaway
  containment policy and retry-idempotent hourly/daily email caps; the host
  injects Redis, claims, ClickHouse counting,
  notifications, and telemetry at the app boundary.
- The concrete service also owns graph-trigger evaluation and heartbeat
  candidate decisions. It receives analytics, ClickHouse, provider, and source
  lookup ports at construction; Trigger/CustomGraph/TriggerSent persistence is
  private to the service.
- The contract owns graph-alert threshold/no-data policy, series-name parsing,
  and canonical persisted series identifiers shared by event and heartbeat
  dispatch.
- `web/` owns browser-safe authoring helpers, graph-series presentation and
  display action parameters, template variable catalogues, Liquid JSON
  substitution, cadence UI, overview presentation, and the browser transport
  client.

The process-owned composition root is split by process:
`apps/api/src/app/api-automation.composition.ts` builds the `AutomationService`
routes consume, and `apps/worker/src/app/worker-automation-*.composition.ts`
builds the graph, settlement, and settlement-reads capabilities the worker
consumes.

Reusable facets, schedule/cadence controls, list cells, query/templating
helpers, and browser presentation live in `web/`, including the transport-bound
drawer controller and provider forms (`web/src/features/authoring/`) — `apps/ui`
hosts them (`apps/ui/src/features/automations/`) rather than owning them. The
remaining app-layer delivery slice is provider-secret handling,
mail/Slack/webhook transports, and persist-cap plan resolution; it does not
introduce another AutomationService.

The app constructs one `AutomationService` and one process-lifetime
`AutomationEmailCapService`. Eventing calls the canonical service's graph
methods; delivery, Redis claims, ClickHouse counting, recipient auth, and
limit mail are injected host capabilities. Graph candidate/source and incident
persistence stay behind Automation's private repositories.
