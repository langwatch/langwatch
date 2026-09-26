import type { ReportRunOutcome } from "@langwatch/automation-contract";
import type { IntentContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

const logger = createLogger("langwatch:automation:report-dispatch");

export const REPORT_SCHEDULE_INTENT_TYPES = { DISPATCH: "dispatchReport" } as const;

/** Delivery attempts before a report send is recorded as finally failed. */
export const REPORT_DISPATCH_MAX_ATTEMPTS = 5;

export const reportDispatchIntentSchema = z.object({
  triggerId: z.string().min(1),
  slot: z.number().int(),
  requestId: z.string().min(1).optional(),
});
export type ReportDispatchIntent = z.infer<typeof reportDispatchIntentSchema>;

/** Renders and sends one report slot; the outbox retries it, so it must tolerate a repeat. */
export interface ReportDispatcher {
  dispatch(input: { projectId: string; triggerId: string; slot: number }): Promise<void>;
}

/** Tells the report's schedule that a run-now's dispatch has ended; late-bound to the pipeline. */
export interface ReportRunSettlement {
  settleRun(input: {
    projectId: string;
    triggerId: string;
    requestId: string;
    outcome: ReportRunOutcome;
  }): Promise<void>;
}

/** The outbox retires a failure thrown with `retryable: false` at once, whatever its attempt. */
function isFinalAttempt({ error, attempt }: { error: unknown; attempt: number }): boolean {
  if (attempt >= REPORT_DISPATCH_MAX_ATTEMPTS) return true;
  return error instanceof Error && "retryable" in error && error.retryable === false;
}

/** A lost settlement must not resend the report, so it is logged rather than retried. */
async function settle({
  runs,
  projectId,
  triggerId,
  requestId,
  outcome,
}: {
  runs: ReportRunSettlement;
  projectId: string;
  triggerId: string;
  requestId: string;
  outcome: ReportRunOutcome;
}): Promise<void> {
  try {
    await runs.settleRun({ projectId, triggerId, requestId, outcome });
  } catch (error) {
    logger.error(
      { projectId, triggerId, requestId, outcome, error },
      "Report run-now ended but recording it failed; run-now stays refused until the next scheduled send",
    );
  }
}

export function runReportDispatch({
  dispatcher,
  runs,
}: {
  dispatcher: ReportDispatcher;
  runs: ReportRunSettlement;
}): (payload: ReportDispatchIntent, context: IntentContext) => Promise<void> {
  return async (payload, context) => {
    const { requestId, triggerId } = payload;
    const { projectId } = context;
    try {
      await dispatcher.dispatch({ projectId, triggerId, slot: payload.slot });
    } catch (error) {
      if (requestId && isFinalAttempt({ error, attempt: context.attempt })) {
        await settle({ runs, projectId, triggerId, requestId, outcome: "failed" });
      }
      throw error;
    }
    if (requestId) {
      await settle({ runs, projectId, triggerId, requestId, outcome: "sent" });
    }
  };
}
