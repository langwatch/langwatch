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
 */
export const handleSendEmail = async (context: TriggerContext) => {
  const { trigger } = context;

  try {
    const input = buildCronGraphAlertInput(context);
    await dispatchGraphAlertAction({
      deps: cronGraphAlertDeps(),
      input,
    });
  } catch (error) {
    captureException(toError(error), {
      extra: {
        triggerId: trigger.id,
        projectId: trigger.projectId,
        action: TriggerAction.SEND_EMAIL,
      },
    });
  }
};
