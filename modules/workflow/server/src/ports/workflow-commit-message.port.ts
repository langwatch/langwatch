/**
 * What writing a commit message for a graph change needs from the process around
 * it: the model this project resolves the feature to, and the policy that turns a
 * provider failure into something the studio can render. The prompt is ours.
 */

import type { ModelRole } from "@langwatch/model-provider-contract";
import type { LanguageModel } from "ai";

/** Resolves one feature key's model for one project. */
export abstract class WorkflowCommitMessageModelPort {
  abstract resolve(input: { projectId: string; featureKey: string }): Promise<LanguageModel>;
}

/** The registered feature a call runs under, as the failure policy reads it. */
export type WorkflowAiCallFeature = Readonly<{
  key: string;
  role: ModelRole;
  displayName: string;
}>;

/**
 * Runs one model call for a named feature, turning any provider or SDK failure
 * into the application's typed `ai_call_failed` cause.
 */
export abstract class WorkflowAiCallPort {
  abstract run<T>(feature: WorkflowAiCallFeature, call: () => Promise<T>): Promise<T>;
}
