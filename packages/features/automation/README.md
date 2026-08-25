# Automation

Automation is the singular feature for trigger definitions, trigger-fire
history, report schedules, delivery policy, and project email suppression.

- `contract/` owns portable Zod 4 schemas, trigger/provider vocabulary,
  templating, report and graph-alert policy, and the abstract `AutomationService`.
- `server/` owns the concrete service, private repositories, schedule ports,
  and webhook delivery records.
- The contract also owns pure graph-alert threshold evaluation, no-data policy,
  and series-name parsing shared by event and heartbeat dispatch.
- `web/` owns browser-safe authoring helpers, template variable catalogues,
  Liquid JSON substitution, cadence UI, and the compatibility HTTP client.

The process-owned composition root is
`platform/app/src/runtime/app/features/automation.ts` (`AppAutomationRuntime`).
It builds one `AutomationService`; routes and workers consume that capability.

Application compatibility fragments remain where they require Prisma, tRPC,
React page composition, mail/Slack credentials, or event-pipeline wiring:
`platform/app/src/features/automations/`,
`platform/app/src/components/automations/`, and
`platform/app/src/server/app-layer/automations/`.
