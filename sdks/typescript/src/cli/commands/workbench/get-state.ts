import type { CommandResult } from "../../utils/output";
import { uiCallCommand } from "../ui/call";

/**
 * Reads the evaluations workbench live -- unsaved drafts, pending cells and
 * in-memory results included. Sugar over `ui call workbench.getState`, so
 * the channel's rules (needs a running agent turn) apply here too.
 */
export const workbenchGetStateCommand = async (
  experiment: string | undefined,
  options: {
    includeResults?: boolean;
  },
): Promise<CommandResult | void> => {
  return uiCallCommand("workbench.getState", {
    payload: JSON.stringify({
      includeResults: options.includeResults !== false,
    }),
    // With the experiment named, the read still answers when no page is open:
    // the platform serves the saved state and marks it `source: "saved"`.
    ...(experiment ? { experiment } : {}),
  });
};
