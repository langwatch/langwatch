import type { z } from "zod";

/**
 * One page-registered UI action the agent may drive
 * (specs/langy/langy-ui-actions.feature).
 */
export interface LangyUiActionHandler {
  payloadSchema: z.ZodTypeAny;
  run: (payload: never) => Promise<unknown> | unknown;
}

/** Everything the current page can execute, keyed by action kind. */
export type LangyUiActionHandlers = Record<string, LangyUiActionHandler>;
