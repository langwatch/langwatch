/**
 * What a run executes its statement as. A project key is not enough: the
 * statement runs as the deployment's LangWatchQL identity, and a deployment
 * that provisions none is the same condition as the feature being off.
 * @see specs/instant-evals/instant-eval-api.feature
 */

import { InstantEvalNotEnabledError } from "@langwatch/instant-eval-contract";

/** The tenant identity one run's statement is executed under. */
export interface InstantEvalQueryCapability {
  readonly id: string;
  readonly lwqlKey: string;
}

/**
 * Refuses as not enabled rather than letting the row source fail later with a
 * reason the caller cannot act on.
 */
export function getInstantEvalQueryCapability({
  project,
  hasDeploymentIdentity,
}: {
  project: { id: string; lwqlKey: string | null } | null;
  hasDeploymentIdentity: boolean;
}): InstantEvalQueryCapability {
  if (!hasDeploymentIdentity) throw new InstantEvalNotEnabledError();
  if (!project?.lwqlKey) throw new InstantEvalNotEnabledError();

  return { id: project.id, lwqlKey: project.lwqlKey };
}
