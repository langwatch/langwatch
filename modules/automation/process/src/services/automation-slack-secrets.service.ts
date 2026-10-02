import { type SlackActionParams, slackDeliveryMethodOf } from "@langwatch/automation-contract";

import { readableSlackActionParams } from "../rules/automation-slack-read.rules.ts";

export interface AutomationSecretCrypto {
  encrypt(value: string): string;
  decrypt(value: string): string;
}

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
  crypto: AutomationSecretCrypto,
): string | null {
  if (!params.slackBotToken) return null;
  return crypto.decrypt(params.slackBotToken);
}

/** Owns Slack action-parameter persistence and secret handling. Crypto is
 * process configuration and is bound once when the service is composed. */
export class AutomationSlackSecretsService extends AutomationSlackProvider {
  private constructor(private readonly crypto: AutomationSecretCrypto) {
    super();
  }

  static create(crypto: AutomationSecretCrypto): AutomationSlackSecretsService {
    return new AutomationSlackSecretsService(crypto);
  }

  persist(input: { incoming: SlackActionParams }): SlackActionParams {
    return persistSlackActionParams(input);
  }

  redact(params: unknown): Record<string, unknown> {
    return readableSlackActionParams(params);
  }

  findDecryptedToken(params: { slackBotToken?: string }): string | null {
    return findDecryptedSlackBotToken(params, this.crypto);
  }
}
