/**
 * Which judge a deployment judges with. Its own key always wins, so it sends nothing to
 * LangWatch; without one it judges through Connect, which skips every organization that has
 * not switched hosted judging on. `null` judges nothing; `memory` is refused in production.
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */

import {
  InstantEvalMemoryJudgeInProductionError,
  type InstantEvalServerConfig,
} from "@langwatch/instant-eval-contract";

type InstantEvalJudgeKind = "none" | "own_key" | "connect" | "memory";

/**
 * Whether the choice waits for the first call: only a setting that lets the key decide does, since
 * the key is the Instant Evals judge's and a peer Api cannot be asked at startup (ADR-174 d. 13).
 */
export function isInstantEvalJudgeChosenOnFirstCall({
  classifier,
}: {
  classifier: InstantEvalServerConfig["classifier"];
}): boolean {
  return classifier === undefined || classifier === "jev";
}

export function instantEvalJudgeKind({
  classifier,
  hasOwnKey,
  isProduction,
}: {
  classifier: InstantEvalServerConfig["classifier"];
  hasOwnKey: boolean;
  isProduction: boolean;
}): InstantEvalJudgeKind {
  if (classifier === "memory") {
    if (isProduction) throw new InstantEvalMemoryJudgeInProductionError();
    return "memory";
  }
  if (classifier === "null") return "none";
  if (classifier === "connect") return "connect";
  return hasOwnKey ? "own_key" : "connect";
}
