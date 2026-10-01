# Automation

Automation is the singular feature for trigger definitions, trigger-fire
history, report schedules, delivery policy, and project email suppression.
It is one module of three packages, laid out as ARCHITECTURE.md §3 describes
(there is no `client/`: no other browser reads automation data).

- `contract/` owns portable Zod 4 schemas, trigger/provider vocabulary,
  templating, report and graph-alert policy, the `AutomationApi` token, and the
  tRPC and REST declarations. The contract also owns graph-alert threshold and
  no-data policy, series-name parsing, and the canonical persisted series
  identifiers shared by event and heartbeat dispatch.
- `process/` owns the services, private repositories, channels (webhook, Slack,
  mail and the other deliveries), the eventing pipeline (subscribers, process
  managers, intents) and the tasks. Its services also own graph-trigger
  evaluation, heartbeat candidate decisions, the reusable persist-cap runaway
  containment policy and the retry-idempotent hourly/daily email caps.
  Trigger, CustomGraph and TriggerSent persistence is private to the module.
- `browser/` owns the module's screens, drawers and publications, declared with
  `defineWebModule` at `./declaration` (`model/` → `behavior/` → `ui/`): the
  authoring drawer and provider forms, graph-series presentation and display
  action parameters, template variable catalogues, Liquid JSON substitution,
  cadence UI, and overview presentation. `apps/ui` installs the generated
  list; it hosts none of this itself.

No app holds an automation composition file. `apps/api` and `apps/worker`
install the module's process half through the generated `serverModules` list,
and the role decides what runs: the api serves the routes, the worker consumes
the pipeline (graph, settlement and settlement reads). Eventing calls the
module's own services; delivery, Redis claims, ClickHouse counting, recipient
auth and limit mail arrive as members and channels the process supplies, never
as a second `AutomationService`.
