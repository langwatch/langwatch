import { defineServerModule } from "@langwatch/runtime-composition";

import { AutomationApp } from "./app/automation.app.ts";
import { automationRepositories } from "./repositories/automation-repositories.registry.ts";
import { createAutomationRest } from "./transport/automation.rest.ts";
import { automationTrpcTransport } from "./transport/automation.trpc.ts";
import { emailSuppressionTrpcTransport } from "./transport/email-suppression.trpc.ts";
import { slackAutomationRest } from "./transport/slack-trigger.rest.ts";
import { unsubscribeRest } from "./transport/unsubscribe.rest.ts";

export type { AutomationInfrastructure } from "./app/automation.app.ts";

export const automationServer = defineServerModule("automation")
  .withRepositories(automationRepositories)
  .withApp(AutomationApp)
  .withTransports(
    createAutomationRest(),
    automationTrpcTransport,
    emailSuppressionTrpcTransport,
    slackAutomationRest,
    unsubscribeRest,
  )
  .build();
