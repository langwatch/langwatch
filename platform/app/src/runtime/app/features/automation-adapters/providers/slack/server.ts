import { SlackProviderAdapter, type AutomationSecretCrypto } from "@langwatch/automation-server";
import { MissingSlackBotTokenError, type SlackActionParams } from "@langwatch/automation-contract";
import { TriggerAction } from "@langwatch/automation-contract";
import { decrypt, encrypt } from "~/utils/encryption";
import type { PersistActionParamsArgs, ServerDef } from "../types";

const secretCrypto: AutomationSecretCrypto = { encrypt, decrypt };
const provider = SlackProviderAdapter.create(secretCrypto);

export const slackBotTokenMissing = provider.tokenMissing.bind(provider);

export function persistSlackActionParams({
  incoming,
  existing,
}: {
  incoming: SlackActionParams;
  existing?: SlackActionParams | null;
}): SlackActionParams {
  return provider.persist({ incoming, existing });
}

export function redactSlackActionParams(params: SlackActionParams): SlackActionParams {
  return provider.redact(params);
}

export function decryptSlackBotToken(params: { slackBotToken?: string }): string | null {
  return provider.tryDecrypt(params);
}

const def: ServerDef = {
  action: TriggerAction.SEND_SLACK_MESSAGE,
  persistActionParams: async ({ incoming, loadExisting }: PersistActionParamsArgs) => {
    const params = incoming as SlackActionParams;
    const existing =
      params.slackDelivery === "bot"
        ? ((await loadExisting()) as SlackActionParams | undefined)
        : undefined;
    if (provider.tokenMissing({ incoming: params, existing })) {
      throw new MissingSlackBotTokenError();
    }
    return persistSlackActionParams({ incoming: params, existing });
  },
  redactActionParams: (params) => redactSlackActionParams((params ?? {}) as SlackActionParams),
};

export default def;
