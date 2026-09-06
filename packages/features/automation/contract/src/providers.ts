/** Shared provider vocabulary used by the automation contract and adapters. */
import { annotationQueueActionParamsSchema } from "./providers/annotation-queue.ts";
import { datasetActionParamsSchema } from "./providers/dataset.ts";
import { emailActionParamsSchema } from "./providers/email.ts";
import { slackActionParamsSchema } from "./providers/slack.ts";
import { webhookActionParamsSchema } from "./providers/webhook.ts";

export type {
  Category,
  PreviewEnvelope,
  SavedTriggerRow,
  SharedDef,
  SlackTemplateTypeColumn,
  TemplateDraft,
} from "./provider-types.ts";
export type AlertType = import("./trigger.ts").AlertType;
export type TriggerAction = import("./trigger.ts").TriggerAction;
export {
  annotationQueueActionParamsSchema,
  type AnnotationQueueActionParams,
} from "./providers/annotation-queue.ts";
export {
  datasetActionParamsSchema,
  datasetMappingSchema,
  traceMappingEntrySchema,
  type DatasetActionParams,
} from "./providers/dataset.ts";
export {
  EMAIL_RX,
  emailActionParamsSchema,
  type EmailActionParams,
  type EmailPreview,
} from "./providers/email.ts";
export {
  SLACK_BOT_TOKEN_KEPT,
  SLACK_DELIVERY_METHODS,
  SLACK_TEMPLATE_TYPES,
  isSlackWebhookUrl,
  slackActionParamsSchema,
  slackDeliveryMethodOf,
  slackDeliveryMethodSchema,
  slackTemplateTypeSchema,
  type SlackActionParams,
  type SlackDeliveryMethod,
  type SlackPreview,
  type SlackPreviewPayload,
  type SlackTemplateType,
} from "./providers/slack.ts";
export {
  WEBHOOK_HEADER_VALUE_KEPT,
  WEBHOOK_METHODS,
  inspectWebhookUrlShape,
  isReservedWebhookHeader,
  sanitizeWebhookHeaders,
  validateWebhookUrlShape,
  webhookActionParamsSchema,
  webhookMethodSchema,
  type WebhookActionParams,
  type WebhookMethod,
  type WebhookPreview,
  type WebhookUrlProblem,
  type WebhookUrlProblemCode,
} from "./providers/webhook.ts";

export const providerActionValues = [
  "SEND_EMAIL",
  "ADD_TO_DATASET",
  "ADD_TO_ANNOTATION_QUEUE",
  "SEND_SLACK_MESSAGE",
  "SEND_WEBHOOK",
] as const;

/** Runtime enum-shaped values for browser/client callers. The corresponding
 * types are exported by `trigger.ts` and remain string-literal unions. */
export const TriggerAction = {
  SEND_EMAIL: "SEND_EMAIL",
  ADD_TO_DATASET: "ADD_TO_DATASET",
  ADD_TO_ANNOTATION_QUEUE: "ADD_TO_ANNOTATION_QUEUE",
  SEND_SLACK_MESSAGE: "SEND_SLACK_MESSAGE",
  SEND_WEBHOOK: "SEND_WEBHOOK",
} as const;

export const AlertType = {
  CRITICAL: "CRITICAL",
  WARNING: "WARNING",
  INFO: "INFO",
} as const;

/** Shared provider registry entries. They remain contract data so web and
 * server adapters pair the same action metadata and Zod validation. */
export const annotationQueueProvider: import("./provider-types.ts").SharedDef = {
  action: TriggerAction.ADD_TO_ANNOTATION_QUEUE,
  category: "action",
  label: "Add to annotation queue",
  description: "Queue matched traces for a human to label.",
  actionParamsSchema: annotationQueueActionParamsSchema,
};
export const datasetProvider: import("./provider-types.ts").SharedDef = {
  action: TriggerAction.ADD_TO_DATASET,
  category: "action",
  label: "Add to dataset",
  description: "Append matched traces to a dataset for later evaluation.",
  actionParamsSchema: datasetActionParamsSchema,
};
export const emailProvider: import("./provider-types.ts").SharedDef = {
  action: TriggerAction.SEND_EMAIL,
  category: "notify",
  label: "Email",
  description: "Send an email to one or more team members or external recipients.",
  actionParamsSchema: emailActionParamsSchema,
};
export const slackProvider: import("./provider-types.ts").SharedDef = {
  action: TriggerAction.SEND_SLACK_MESSAGE,
  category: "notify",
  label: "Slack",
  description: "Post a message to a Slack webhook when a trace matches.",
  alertDescription: "Post a message to a Slack webhook when the alert fires.",
  actionParamsSchema: slackActionParamsSchema,
};
export const webhookProvider: import("./provider-types.ts").SharedDef = {
  action: TriggerAction.SEND_WEBHOOK,
  category: "notify",
  label: "Webhook",
  description: "Send an HTTP request when an automation matches.",
  actionParamsSchema: webhookActionParamsSchema,
};
