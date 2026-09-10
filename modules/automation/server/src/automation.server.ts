import { defineServerModule } from "@langwatch/runtime-composition";

import { AutomationApp } from "./app/automation.app.ts";
import { automationRepositories } from "./repositories/automation-repositories.registry.ts";
import { automationTrpcTransport } from "./transport/automation.trpc.ts";
import { emailSuppressionTrpcTransport } from "./transport/email-suppression.trpc.ts";
import { slackAutomationRest } from "./transport/slack-trigger.rest.ts";
import { unsubscribeRest } from "./transport/unsubscribe.rest.ts";

export type { AutomationInfrastructure } from "./app/automation.app.ts";

/**
 * `/api/triggers` is missing on purpose: its rows carry a platform URL, which
 * only the mounting process can build, so it is declared by
 * `createAutomationRest(platformUrl)` and mounted beside these.
 */
export const automationServer = defineServerModule("automation")
  .withRepositories(automationRepositories)
  .withApp(AutomationApp)
  .withTransports(
    automationTrpcTransport,
    emailSuppressionTrpcTransport,
    slackAutomationRest,
    unsubscribeRest,
  )
  .build();
