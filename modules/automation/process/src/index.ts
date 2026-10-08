export { automationProcessModule } from "./automation.module.ts";

export { createAutomationRest } from "./transport/automation.rest.ts";
export { automationTrpcTransport } from "./transport/automation.trpc.ts";
export { emailSuppressionTrpcTransport } from "./transport/email-suppression.trpc.ts";
export { slackAutomationRest } from "./transport/slack-trigger.rest.ts";
export { unsubscribeRest } from "./transport/unsubscribe.rest.ts";

export { SlackAlertTask } from "./tasks/slack-alert.task.ts";
