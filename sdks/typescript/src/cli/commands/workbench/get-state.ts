import { uiCallCommand } from "../ui/call";

/**
 * Read the evaluations workbench as the user sees it right now — unsaved
 * prompt drafts, pending cells and in-memory results included. Sugar over
 * `ui call workbench.getState`, so everything about the channel (needs a
 * running agent turn, answers from the open page) applies here too.
 */
export const workbenchGetStateCommand = async (
  experiment: string | undefined,
  options: {
    includeResults?: boolean;
  },
): Promise<void> => {
  await uiCallCommand("workbench.getState", {
    payload: JSON.stringify({
      includeResults: options.includeResults !== false,
    }),
    // With the experiment named, the read still answers when no page is open:
    // the platform serves the saved state and marks it `source: "saved"`.
    ...(experiment ? { experiment } : {}),
  });
};
