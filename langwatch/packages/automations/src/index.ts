/**
 * @langwatch/automations — the automation domain shared across the app,
 * CLI, MCP server, and web surfaces (no database, no React, no server-only
 * dependencies).
 *
 * Entry points:
 *   .                      — enums + provider vocabulary (this file)
 *   ./cadences             — notification cadence constants + helpers
 *   ./providers/<name>     — one provider's shared definition (Zod schema,
 *                            labels, category); `types` for the vocabulary
 *   ./templating/<module>  — Liquid template engine, renderers, defaults
 *
 * The React halves (ConfigForms, client registry) live in the app under
 * `features/automations/providers`; the server halves (secret persistence,
 * dispatch) under `server/app-layer/automations/providers`.
 */

export { AlertType, TriggerAction, TriggerKind, WebhookDeliveryOutcome } from "./enums";
export type {
  Category,
  PreviewEnvelope,
  SavedTriggerRow,
  SharedDef,
  SlackTemplateTypeColumn,
  TemplateDraft,
} from "./providers/types";
