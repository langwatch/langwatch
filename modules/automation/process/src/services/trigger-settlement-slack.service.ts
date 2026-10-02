import {
  renderTriggerSlack,
  resolveSlackTemplateType,
  type TemplateContext,
  type TriggerSummary,
} from "@langwatch/automation-contract";
import { DispatchError } from "@langwatch/eventing";

import type { AutomationNotificationDelivery } from "../channels/automation-notification-delivery.channel.ts";
import type { SlackDestinationService } from "./slack-destination.service.ts";
import type { SettlementNotificationCandidate } from "./trigger-settlement-email.service.ts";

type SlackComposition = {
  delivery: AutomationNotificationDelivery;
  slackDestinations: Pick<
    SlackDestinationService,
    "findSlackDestination" | "getMissingDispatchError"
  >;
  baseHost: string;
};

export class TriggerSettlementSlackService {
  private constructor(private readonly composition: SlackComposition) {}

  static create(composition: SlackComposition): TriggerSettlementSlackService {
    return new TriggerSettlementSlackService(composition);
  }

  async send(input: {
    trigger: TriggerSummary;
    triggerData: SettlementNotificationCandidate[];
    projectSlug: string;
    projectId: string;
    context: () => TemplateContext;
  }): Promise<void> {
    // Its connection, else its own legacy secret (ARCHITECTURE.md §3); nothing dead-letters.
    const [destination] = await this.composition.slackDestinations.findSlackDestination({
      projectId: input.projectId,
      actionParams: input.trigger.actionParams,
    });
    if (!destination) {
      throw this.composition.slackDestinations.getMissingDispatchError({
        triggerName: input.trigger.name,
      });
    }

    if (destination.kind === "bot") {
      const { token, channel } = destination;
      if (!channel) {
        throw new DispatchError({
          message: `Slack bot connection for trigger "${input.trigger.name}" is missing its channel`,
          customerMessage:
            "This automation has no Slack channel to post in. Pick a channel in its delivery settings.",
          retryable: false,
        });
      }

      const rendered = await renderTriggerSlack({
        templateType: resolveSlackTemplateType({
          configured: input.trigger.templates.slackTemplateType,
          deliveryMethod: "bot",
        }),
        template: input.trigger.templates.slackTemplate,
        context: input.context(),
        allowGatedBlocks: true,
      });
      await this.composition.delivery.sendSlackBot({
        token,
        channel,
        payload: rendered.payload,
        triggerName: input.trigger.name,
      });

      return;
    }

    if (input.trigger.templates.slackTemplate !== null) {
      const rendered = await renderTriggerSlack({
        templateType: resolveSlackTemplateType({
          configured: input.trigger.templates.slackTemplateType,
          deliveryMethod: "webhook",
        }),
        template: input.trigger.templates.slackTemplate,
        context: input.context(),
      });
      await this.composition.delivery.sendSlackWebhook({
        webhook: destination.url,
        triggerName: input.trigger.name,
        payload: rendered.payload,
      });

      return;
    }

    await this.composition.delivery.sendLegacySlackWebhook({
      webhook: destination.url,
      triggerData: input.triggerData,
      triggerName: input.trigger.name,
      projectSlug: input.projectSlug,
      triggerType: input.trigger.alertType,
      triggerMessage: input.trigger.message ?? "",
      baseHost: this.composition.baseHost,
    });
  }
}
