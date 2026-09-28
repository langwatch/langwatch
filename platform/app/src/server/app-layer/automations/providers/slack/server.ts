import {
  SLACK_BOT_TOKEN_KEPT,
  type SlackActionParams,
  slackDeliveryMethodOf,
} from "@langwatch/automations/providers/slack";
import { TriggerAction } from "~/generated/prisma/client";
import { decrypt, encrypt } from "~/utils/encryption";
import type { PersistActionParamsArgs, ServerDef } from "../types";

/**
 * Server half of the Slack provider (ADR-041). The bot token is AES-256-GCM
 * encrypted at rest (shared `encrypt`/`decrypt`, CREDENTIALS_SECRET) and
 * NEVER leaves the server in either direction:
 *  - persist: encrypt a freshly-entered token, or keep the stored ciphertext
 *    when the author left it blank on edit.
 *  - read: strip the ciphertext, echo only a `slackBotTokenSet` flag.
 *  - deliver: decrypt just before the Web API call.
 */

/**
 * Prepare Slack actionParams for persistence: encrypt a new bot token, keep the
 * existing ciphertext when the field was left blank on edit, and strip fields
 * that don't belong to the chosen delivery method (so a webhook automation never
 * carries a stale token, and vice versa). Read-only echo flags are dropped.
 */
export function persistSlackActionParams({
  incoming,
  existing,
}: {
  incoming: SlackActionParams;
  existing?: SlackActionParams | null;
}): SlackActionParams {
  // A connection carries the secret (ADR-093 §5a): the row keeps only the id,
  // the method its kind implies, and a bot connection's channel.
  if (incoming.slackIntegrationId) {
    const slackDelivery = slackDeliveryMethodOf(incoming);
    const channel = incoming.slackChannelId?.trim();
    return {
      slackIntegrationId: incoming.slackIntegrationId,
      slackDelivery,
      ...(slackDelivery === "bot" && channel
        ? { slackChannelId: channel }
        : {}),
    };
  }
  const method = slackDeliveryMethodOf(incoming);
  if (method === "webhook") {
    return {
      slackDelivery: "webhook",
      slackWebhook: incoming.slackWebhook?.trim(),
    };
  }

  const raw = incoming.slackBotToken?.trim();
  const keepExisting = !raw || raw === SLACK_BOT_TOKEN_KEPT;
  const slackBotToken = keepExisting
    ? existing?.slackBotToken // already ciphertext
    : encrypt(raw);
  return {
    slackDelivery: "bot",
    slackChannelId: incoming.slackChannelId?.trim(),
    // Omitted, not `undefined`: the stored JSON must carry no token KEY when
    // there is no token, so a read never mistakes the field for present.
    ...(slackBotToken === undefined ? {} : { slackBotToken }),
  };
}

/** Replace the stored ciphertext with a boolean flag before the row is sent to
 *  the browser — the token (encrypted or not) must never reach the client. */
export function redactSlackActionParams(
  params: SlackActionParams,
): SlackActionParams {
  // A migrated row keeps its legacy secret for one release; the connection is
  // what it delivers through, so the secret has nothing left to say.
  if (params.slackIntegrationId) {
    const {
      slackBotToken: _t,
      slackWebhook: _w,
      slackBotTokenSet: _s,
      ...rest
    } = params;
    return rest;
  }
  if (!params.slackBotToken) return params;
  const { slackBotToken: _drop, ...rest } = params;
  return { ...rest, slackBotTokenSet: true };
}

/** Decrypt the stored bot token for a Web API dispatch. Null when absent. */
export function decryptSlackBotToken(
  params: Pick<SlackActionParams, "slackBotToken">,
): string | null {
  if (!params.slackBotToken) return null;
  return decrypt(params.slackBotToken);
}

const def: ServerDef = {
  action: TriggerAction.SEND_SLACK_MESSAGE,
  persistActionParams: async ({
    incoming,
    loadExisting,
  }: PersistActionParamsArgs) => {
    const params = incoming as SlackActionParams;
    const existing =
      !params.slackIntegrationId && slackDeliveryMethodOf(params) === "bot"
        ? ((await loadExisting()) as SlackActionParams | undefined)
        : undefined;
    // No token check here (ADR-093 §5a): the save path points the params at a
    // connection first, and "nothing to deliver with" is the dispatch-time
    // resolver's refusal, `slack_integration_missing`.
    return persistSlackActionParams({ incoming: params, existing });
  },
  redactActionParams: (params) =>
    redactSlackActionParams((params ?? {}) as SlackActionParams),
};

export default def;
