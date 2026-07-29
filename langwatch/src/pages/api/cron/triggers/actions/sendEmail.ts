import { createLogger } from "@langwatch/observability";
import { TriggerAction } from "@prisma/client";
import { dispatchGraphAlertAction } from "~/server/event-sourcing/pipelines/shared/graphAlertActionDispatch";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import type { TriggerContext } from "../types";
import {
  buildCronGraphAlertInput,
  cronGraphAlertDeps,
} from "./graphAlertDispatch";

/**
 * Email a custom-graph alert from the cron path.
 *
 * The send goes through the shared `dispatchGraphAlertAction`, which owns
 * EVERY email-only guard both evaluation paths must agree on: the ADR-031
 * suppression list, the per-trigger hourly cap, the per-project daily cap,
 * and the per-recipient at-most-once ledger — all keyed on `fireDigest`, so a
 * cron re-tick of the same fire re-reads the cap counts instead of burning a
 * second slot. Keeping the guards inside the dispatcher (rather than here) is
 * what makes the parity contract hold: `release_es_graph_triggers_firing`
 * decides WHO evaluates, never what the customer receives.
 *
 * The dispatcher also renders the author's saved Liquid templates against
 * `ALERT_TRIGGER_DEFAULTS` — the very copy they previewed in the drawer —
 * instead of the legacy React email tree, which ignored the four template
 * columns entirely.
 *
 * Returns the dispatcher's `didSend` so the caller can decide whether to
 * record the incident: dispatch errors are captured (never thrown — a cron
 * batch must not die on one alert) but reported as `didSend: false`, so an
 * undelivered alert does NOT open an incident and the next tick retries.
 * A cap-exhausted drop stays `didSend: true`, matching the event-sourced path.
 */
export const handleSendEmail = async (
  context: TriggerContext,
): Promise<{ didSend: boolean }> => {
  const { trigger } = context;

  try {
    const input = buildCronGraphAlertInput(context);
    const result = await dispatchGraphAlertAction({
      deps: cronGraphAlertDeps(),
      input,
    });
    return { didSend: result.didSend };
  } catch (error) {
    captureException(toError(error), {
      extra: {
        triggerId: trigger.id,
        projectId: trigger.projectId,
        action: TriggerAction.SEND_EMAIL,
      },
    });
    return { didSend: false };
  }
};
