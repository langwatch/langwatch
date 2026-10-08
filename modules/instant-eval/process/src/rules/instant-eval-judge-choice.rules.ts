/**
 * Which judge a deployment judges with: LangWatch Cloud with LangWatch's classifier key, any other
 * install through Connect; a self-hosted install's key is never used (ADR-174 d. 14).
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */

import {
  InstantEvalMemoryJudgeInProductionError,
  type InstantEvalServerConfig,
} from "@langwatch/instant-eval-contract";

export type InstantEvalJudgeKind = "none" | "cloud" | "connect" | "memory";

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

/**
 * Where the deployment's judge runs, as a refusal reads it (main #8416): `off`, its own key
 * (LangWatch Cloud's, or the deterministic stand-in), through LangWatch, or a Connect judge
 * with Connect switched off for the deployment, which nothing can judge through.
 */
export type InstantEvalJudgeRoute = "off" | "own_key" | "connect" | "disconnected";

export function instantEvalJudgeRoute({
  kind,
  isConnectPermitted,
}: {
  kind: InstantEvalJudgeKind;
  isConnectPermitted: boolean;
}): InstantEvalJudgeRoute {
  if (kind === "none") return "off";
  if (kind === "cloud" || kind === "memory") return "own_key";
  return isConnectPermitted ? "connect" : "disconnected";
}
