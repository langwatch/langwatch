import type { SlackDeliveryMethod } from "@langwatch/automations/providers/slack";
import type { TriggerActionParams } from "./triggerActionParams";

/**
 * The one decision both Slack-destination display surfaces need: what kind
 * of delivery a `SEND_SLACK_MESSAGE` row actually is, and what's safe to
 * show for it. Pure and framework-free so `ViewAutomationDrawer.tsx` (the
 * drawer) and `pages/[project]/automations.tsx` (the list page's "Notifies"
 * cell) render the exact same call — each still owns its own JSX/styling,
 * only the underlying decision is shared.
 *
 * #6244: before this, both surfaces (independently) rendered every Slack
 * row as "Webhook"/"Slack webhook", including bot-token deliveries — which
 * never carry a webhook at all — so neither could answer "where does this
 * actually post?". Fixed once here instead of drifting into two
 * hand-maintained copies again.
 */
export type SlackDestinationPresentation =
  | {
      kind: "bot";
      /** The destination channel's raw Slack id (e.g. `C0123456`), or
       *  `null` when the automation hasn't had one chosen yet. No channel
       *  NAME is ever persisted (only the composer, live and
       *  bot-token-authenticated, can resolve one) — the id is still the
       *  exact identifier the author picked, so it's shown plainly rather
       *  than hidden. */
      channelId: string | null;
    }
  | {
      kind: "webhook";
      /** The webhook URL, ONLY when it's safe to show on hover — a real
       *  Slack incoming webhook always starts `https://hooks.slack.com/…`.
       *  `null` for an absent value, or a non-URL placeholder (e.g. a
       *  future redaction substitute from the WS-8 REST-redaction work):
       *  there is nothing meaningful to show on hover, so callers must
       *  render the masked label with no tooltip rather than risk exposing
       *  or misrepresenting the placeholder as though it were the URL. */
      tooltipUrl: string | null;
    };

/** The value, only when it parses as a real https URL — a bare "https://"
 *  or a redaction placeholder wearing the prefix is not a URL to show. */
function safeHttpsUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

export function slackDestinationPresentation(
  actionParams: Pick<
    TriggerActionParams,
    "slackDelivery" | "slackChannelId" | "slackWebhook"
  >,
): SlackDestinationPresentation {
  // Absent `slackDelivery` means a legacy row saved before bot delivery
  // existed — back-compat default to webhook. The switch is exhaustive over
  // `SlackDeliveryMethod`, so a new delivery method fails typecheck here
  // instead of silently presenting as a webhook.
  const delivery: SlackDeliveryMethod = actionParams.slackDelivery ?? "webhook";
  switch (delivery) {
    case "bot":
      return { kind: "bot", channelId: actionParams.slackChannelId ?? null };
    case "webhook": {
      return {
        kind: "webhook",
        tooltipUrl: safeHttpsUrl(actionParams.slackWebhook),
      };
    }
  }
}
