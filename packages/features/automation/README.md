# Automation

Automation is the singular feature for trigger definitions, trigger-fire
history, report schedules, delivery policy, and project email suppression.

- `contract/` owns portable Zod 4 schemas, trigger/provider vocabulary,
  templating, report and graph-alert policy, and the abstract `AutomationService`.
- `server/` owns the concrete service, private repositories, schedule ports,
  and webhook delivery records. It also owns the reusable persist-cap runaway
  containment policy; the host injects claims, ClickHouse counting,
  notifications, and telemetry at the app boundary.
- The concrete service also owns graph-trigger evaluation and heartbeat
  candidate decisions. It receives analytics, ClickHouse, provider, and source
  lookup ports at construction; Trigger/CustomGraph/TriggerSent persistence is
  private to the service.
- The contract owns graph-alert threshold/no-data policy and series-name
  parsing shared by event and heartbeat dispatch.
- `web/` owns browser-safe authoring helpers, template variable catalogues,
  Liquid JSON substitution, cadence UI, overview presentation, and the browser
  transport client.

The process-owned composition root is
`platform/app/src/runtime/app/features/automation.ts` (`AppAutomationRuntime`).
It builds one `AutomationService`; routes and workers consume that capability.

The application retains transport and composition code where it requires
Prisma, tRPC, page/routing composition, mail/Slack credentials, or Eventing
wiring: `platform/app/src/features/automations/`,
`platform/app/src/components/automations/`, and the app-layer delivery
adapters.

The app constructs one AutomationService once. Eventing calls its graph
methods; delivery, Redis claims, ClickHouse counting, recipient auth, and
limit mail are injected host capabilities. Graph candidate/source and incident
persistence stay behind Automation's private repositories.
