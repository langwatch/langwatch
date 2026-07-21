import type { TargetConfig } from "../types";

/** What a name lookup yields, whichever entity it fetched. */
export type NamedEntity = { name?: string | null; handle?: string | null };

/**
 * A target's display name, given its already-resolved entity.
 *
 * Pure, and the ONE definition of the precedence (prompts prefer the globally
 * unique handle, then the plain name, then a "New Prompt" placeholder). Both
 * the frontend hooks and the server orchestrator name variants, and users
 * compare those names side by side — a column header saying "support-detailed"
 * while the run's message says something else is a bug report waiting to
 * happen. Keeping one implementation is what makes them agree.
 *
 * The entity comes from tRPC on the client and from the run's loaded prompt /
 * evaluator maps on the server; this function does not care which.
 *
 * An empty string means "not known yet" — the client renders that as a blank
 * space while loading, but a server-side message must not, so callers without a
 * loading state should substitute their own fallback (see variantDisplayNameFor
 * in the orchestrator).
 */
export const pickTargetName = ({
  target,
  entity,
  isLoading,
}: {
  target: TargetConfig | undefined;
  entity: NamedEntity | undefined;
  isLoading: boolean;
}): string => {
  if (!target) return "";
  if (target.type === "prompt") {
    if (!target.promptId) return "New Prompt";
    if (isLoading) return "";
    return entity?.handle ?? entity?.name ?? "New Prompt";
  }
  if (target.type === "agent" || target.type === "evaluator") {
    if (isLoading) return "";
    return entity?.name ?? "";
  }
  return "";
};
