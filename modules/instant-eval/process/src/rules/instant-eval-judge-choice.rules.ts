/**
 * Which judge a deployment judges with. LangWatch Cloud judges with LangWatch's classifier key;
 * any other install judges through Connect, which skips every organization that has not switched
 * hosted judging on. A key a self-hosted install sets is never used (ADR-174 decision 14).
 * `null` judges nothing; `memory` is refused in production.
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */

import {
  InstantEvalMemoryJudgeInProductionError,
  type InstantEvalServerConfig,
} from "@langwatch/instant-eval-contract";

type InstantEvalJudgeKind = "none" | "cloud" | "connect" | "memory";

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
  hasCloudKey,
  isProduction,
}: {
  classifier: InstantEvalServerConfig["classifier"];
  hasCloudKey: boolean;
  isProduction: boolean;
}): InstantEvalJudgeKind {
  if (classifier === "memory") {
    if (isProduction) throw new InstantEvalMemoryJudgeInProductionError();
    return "memory";
  }
  if (classifier === "null") return "none";
  if (classifier === "connect") return "connect";
  return hasCloudKey ? "cloud" : "connect";
}
