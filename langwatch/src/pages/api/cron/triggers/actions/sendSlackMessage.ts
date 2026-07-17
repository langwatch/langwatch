import { TriggerAction } from "@prisma/client";
import { dispatchGraphAlertAction } from "~/server/event-sourcing/pipelines/shared/graphAlertActionDispatch";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import type { TriggerContext } from "../types";
import {
  buildCronGraphAlertInput,
  cronGraphAlertDeps,
} from "./graphAlertDispatch";

/**
 * Post a custom-graph alert to Slack from the cron path.
 *
 * Delegates to the shared `dispatchGraphAlertAction`, which owns BOTH delivery
 * methods: a legacy incoming webhook, and — the default the Slack config seeds
 * for every new automation — a bot connection posting through `chat.postMessage`
 * with the stored token. The cron used to know only about webhooks, so a bot
 * automation POSTed to `""`, threw, and had the throw swallowed here while the
 * caller still recorded the incident: the alert read as "currently firing" and
 * nothing was ever sent.
 *
 * Returns the dispatcher's `didSend` so the caller can decide whether to
 * record the incident: dispatch errors are captured (never thrown — a cron
 * batch must not die on one alert) but reported as `didSend: false`, so an
 * undelivered alert does NOT open an incident and the next tick retries.
 */
export const handleSendSlackMessage = async (
  context: TriggerContext,
): Promise<{ didSend: boolean }> => {
  const { trigger } = context;

  try {
    const result = await dispatchGraphAlertAction({
      deps: cronGraphAlertDeps(),
      input: buildCronGraphAlertInput(context),
    });
    return { didSend: result.didSend };
  } catch (error) {
    captureException(toError(error), {
      extra: {
        triggerId: trigger.id,
        projectId: trigger.projectId,
        action: TriggerAction.SEND_SLACK_MESSAGE,
      },
    });
    return { didSend: false };
  }
};
