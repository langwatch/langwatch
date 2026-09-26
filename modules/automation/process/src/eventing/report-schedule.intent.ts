import type { IntentContext } from "@langwatch/eventing";
import { z } from "zod";

export const REPORT_SCHEDULE_INTENT_TYPES = { DISPATCH: "dispatchReport" } as const;

export const reportDispatchIntentSchema = z.object({
  triggerId: z.string().min(1),
  slot: z.number().int(),
});
export type ReportDispatchIntent = z.infer<typeof reportDispatchIntentSchema>;

/** Renders and sends one report slot; the outbox retries it, so it must tolerate a repeat. */
export interface ReportDispatcher {
  dispatch(input: { projectId: string; triggerId: string; slot: number }): Promise<void>;
}

export function runReportDispatch(
  dispatcher: ReportDispatcher,
): (payload: ReportDispatchIntent, context: IntentContext) => Promise<void> {
  return (payload, context) =>
    dispatcher.dispatch({
      projectId: context.projectId,
      triggerId: payload.triggerId,
      slot: payload.slot,
    });
}
