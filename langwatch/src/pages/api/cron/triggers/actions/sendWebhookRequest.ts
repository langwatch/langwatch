import { TriggerAction } from "@prisma/client";
import { dispatchGraphAlertAction } from "~/server/event-sourcing/pipelines/shared/graphAlertActionDispatch";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import type { TriggerContext } from "../types";
import {
  buildCronGraphAlertInput,
  cronGraphAlertDeps,
} from "./graphAlertDispatch";

/**
 * Deliver a custom-graph alert to a customer webhook from the cron path
 * (ADR-040). Same shape as `sendSlackMessage.ts`: delegates to the shared
 * `dispatchGraphAlertAction` (which owns rendering, the SSRF-fenced send, and
 * the per-fire idempotency gate) so the cron and the event-sourced evaluator
 * deliver identically — the firing flag only decides who calls it.
 *
 * Dispatch errors are captured (never thrown — a cron batch must not die on
 * one alert) and reported as `didSend: false`, so an undelivered alert does
 * NOT open an incident and the next tick retries.
 */
export const handleSendWebhookRequest = async (
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
        action: TriggerAction.SEND_WEBHOOK,
      },
    });
    return { didSend: false };
  }
};
