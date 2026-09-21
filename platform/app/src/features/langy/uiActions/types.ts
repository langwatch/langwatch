import type { z } from "zod";

/**
 * One page-registered UI action the agent may drive
 * (specs/langy/langy-ui-actions.feature).
 *
 * `payloadSchema` is the SAME zod schema the server validated the dispatch
 * with (both sides import the page's action manifest), re-run here before the
 * handler sees anything: the stream is trusted transport, but the page only
 * ever executes a payload it re-validated itself. `run` receives the parsed
 * payload and its return value travels back to the agent as the action's
 * result.
 */
export interface LangyUiActionHandler {
  payloadSchema: z.ZodTypeAny;
  run: (payload: never) => Promise<unknown> | unknown;
}

/** Everything the current page can execute, keyed by action kind. */
export type LangyUiActionHandlers = Record<string, LangyUiActionHandler>;
