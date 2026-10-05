import { type SlackActionParams, slackDeliveryMethodOf } from "@langwatch/automation-contract";

import type { TriggerSecretSeal } from "../repositories/trigger.repository.ts";
import { readableSlackActionParams } from "../rules/automation-slack-read.rules.ts";

export abstract class AutomationSlackProvider {
  abstract findDecryptedToken(params: { slackBotToken?: string }): string | null;
}

/**
 * Slack params in their at-rest shape: the save path has already pointed them
 * at a connection (`AutomationSlackConnectionService.connectActionParams`);
 * whatever it could not, stores no secret either way.
 */
function persistSlackActionParams({
  incoming,
}: {
  incoming: SlackActionParams;
}): SlackActionParams {
  const slackDelivery = slackDeliveryMethodOf(incoming);
  const channel = incoming.slackChannelId?.trim();
  return {
    ...(incoming.slackIntegrationId ? { slackIntegrationId: incoming.slackIntegrationId } : {}),
    slackDelivery,
    ...(slackDelivery === "bot" && channel ? { slackChannelId: channel } : {}),
  };
}

function findDecryptedSlackBotToken(
  params: { slackBotToken?: string },
  triggers: TriggerSecretSeal,
): string | null {
  if (!params.slackBotToken) return null;
  return triggers.openSecret({ sealed: params.slackBotToken });
}

/** Owns Slack action-parameter persistence and secret handling; the trigger
 * repository opens a legacy stored token (ARCHITECTURE.md §3.2). */
export class AutomationSlackSecretsService extends AutomationSlackProvider {
  private constructor(private readonly triggers: TriggerSecretSeal) {
    super();
  }

  static create(triggers: TriggerSecretSeal): AutomationSlackSecretsService {
    return new AutomationSlackSecretsService(triggers);
  }

  persist(input: { incoming: SlackActionParams }): SlackActionParams {
    return persistSlackActionParams(input);
  }

  redact(params: unknown): Record<string, unknown> {
    return readableSlackActionParams(params);
  }

  findDecryptedToken(params: { slackBotToken?: string }): string | null {
    return findDecryptedSlackBotToken(params, this.triggers);
  }
}
