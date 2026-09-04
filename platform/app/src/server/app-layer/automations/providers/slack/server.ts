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
      slackDeliveryMethodOf(params) === "bot"
        ? ((await loadExisting()) as SlackActionParams | undefined)
        : undefined;
    // No token check here any more (ADR-093 §5). A bot connection is allowed to
    // store no token at all: the project's Slack integration serves it, and
    // persist cannot see that column. The "nothing to deliver with" refusal
    // moved to the one place that can read both storage locations — the
    // dispatch-time resolver, which raises `slack_integration_missing`.
    return persistSlackActionParams({ incoming: params, existing });
  },
  redactActionParams: (params) =>
    redactSlackActionParams((params ?? {}) as SlackActionParams),
};

export default def;
