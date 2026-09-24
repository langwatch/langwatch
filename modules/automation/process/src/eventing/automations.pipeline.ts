/**
 * Automation's `automations` pipeline, ported from the deleted worker settlement composition:
 * the app builds the definition over its settlement, and binds the senders once registered.
 */
import { defineEventingModule, type EventingSetup } from "@langwatch/eventing";

import type { AutomationApp } from "../app/automation.app.ts";

export const automationsEventing = defineEventingModule({
  pipeline: "automations",
  build: ({ app, processStore }: EventingSetup<never, AutomationApp>) =>
    app.eventingPipeline({ retention: processStore }),
  connect: ({ app, commands }) => app.connectCommands(commands),
});
