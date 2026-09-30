/**
 * Which judge a deployment judges with. Its own key always wins, so it sends nothing to
 * LangWatch; without one it judges through Connect, which skips every organization that has
 * not switched hosted judging on. `null` judges nothing.
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */

import type { InstantEvalServerConfig } from "@langwatch/instant-eval-contract";

export type InstantEvalJudgeKind = "none" | "own_key" | "connect";

export function instantEvalJudgeKind({
  classifier,
  hasOwnKey,
}: {
  classifier: InstantEvalServerConfig["classifier"];
  hasOwnKey: boolean;
}): InstantEvalJudgeKind {
  if (classifier === "null") return "none";
  if (classifier === "connect") return "connect";
  return hasOwnKey ? "own_key" : "connect";
}
