import {
  SLACK_BOT_TOKEN_KEPT,
  MissingSlackBotTokenError,
  type SlackActionParams,
  slackDeliveryMethodOf,
} from "@langwatch/automation-contract";
import { AutomationSlackProvider } from "../ports/automation-provider.port.ts";
import { AutomationSlackBotTokenDecryptor } from "../ports/automation-graph.port.ts";

export interface AutomationSecretCrypto {
  encrypt(value: string): string;
  decrypt(value: string): string;
}

function slackBotTokenMissing({
  incoming,
  existing,
}: {
  incoming: SlackActionParams;
  existing?: SlackActionParams | null;
}): boolean {
  if (slackDeliveryMethodOf(incoming) !== "bot") return false;
  const raw = incoming.slackBotToken?.trim();
  const providingNew = !!raw && raw !== SLACK_BOT_TOKEN_KEPT;
  return !providingNew && !existing?.slackBotToken;
}

function persistSlackActionParams({
  incoming,
  existing,
  crypto,
}: {
  incoming: SlackActionParams;
  existing?: SlackActionParams | null;
  crypto: AutomationSecretCrypto;
}): SlackActionParams {
  const method = slackDeliveryMethodOf(incoming);
  if (method === "webhook") {
    return {
      slackDelivery: "webhook",
      slackWebhook: incoming.slackWebhook?.trim(),
    };
  }

  const raw = incoming.slackBotToken?.trim();
  const keepExisting = !raw || raw === SLACK_BOT_TOKEN_KEPT;
  const slackBotToken = keepExisting ? existing?.slackBotToken : crypto.encrypt(raw);
  return {
    slackDelivery: "bot",
    slackChannelId: incoming.slackChannelId?.trim(),
    slackBotToken,
  };
}

function redactSlackActionParams(params: SlackActionParams): SlackActionParams {
  if (!params.slackBotToken) return params;
  const { slackBotToken: _drop, ...rest } = params;
  return { ...rest, slackBotTokenSet: true };
}

function decryptSlackBotToken(
  params: { slackBotToken?: string },
  crypto: AutomationSecretCrypto,
): string | null {
  if (!params.slackBotToken) return null;
  return crypto.decrypt(params.slackBotToken);
}

function assertSlackBotToken(
  incoming: SlackActionParams,
  existing: SlackActionParams | null | undefined,
): void {
  if (slackBotTokenMissing({ incoming, existing })) {
    throw new MissingSlackBotTokenError();
  }
}

/** Owns Slack action-parameter persistence and secret handling. Crypto is
 * process configuration and is bound once when the adapter is composed. */
export class SlackProviderAdapter extends AutomationSlackProvider {
  private constructor(private readonly crypto: AutomationSecretCrypto) {
    super();
  }

  static create(crypto: AutomationSecretCrypto): SlackProviderAdapter {
    return new SlackProviderAdapter(crypto);
  }

  tokenMissing(input: {
    incoming: SlackActionParams;
    existing?: SlackActionParams | null;
  }): boolean {
    return slackBotTokenMissing(input);
  }

  persist(input: {
    incoming: SlackActionParams;
    existing?: SlackActionParams | null;
  }): SlackActionParams {
    return persistSlackActionParams({ ...input, crypto: this.crypto });
  }

  redact(params: SlackActionParams): SlackActionParams {
    return redactSlackActionParams(params);
  }

  tryDecrypt(params: { slackBotToken?: string }): string | null {
    return decryptSlackBotToken(params, this.crypto);
  }

  assertToken(incoming: SlackActionParams, existing: SlackActionParams | null | undefined): void {
    assertSlackBotToken(incoming, existing);
  }
}

/**
 * Narrows the Slack provider to the one thing evaluation asks of it.
 *
 * `SlackProviderAdapter` also persists and redacts action parameters, which is
 * the drawer's business, not this path's. The wrapper is what keeps the
 * evaluator's dependency honest — and it is a class rather than an object
 * literal because the port it satisfies is nominal.
 */
export class SlackBotTokenDecryptorAdapter extends AutomationSlackBotTokenDecryptor {
  constructor(private readonly provider: SlackProviderAdapter) {
    super();
  }

  tryDecrypt(params: SlackActionParams): string | null {
    return this.provider.tryDecrypt(params);
  }
}
