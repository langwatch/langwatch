/**
 * The project's own query capability, or null when it has none.
 *
 * A project key is not enough: the statement runs as the deployment's
 * LangWatchQL identity, and a deployment that provisions none has nothing to
 * run it as. That is the same condition as the feature being off, so the run
 * service answers it the same way (`instant_eval_not_enabled`) instead of the
 * row source failing later with an error the caller cannot act on.
 *
 * @see ../../../../../specs/instant-evals/instant-eval-api.feature
 */
export function queryCapabilityOf({
  project,
  hasDeploymentIdentity,
}: {
  project: { id: string; lwqlKey: string | null } | null;
  hasDeploymentIdentity: boolean;
}): { id: string; lwqlKey: string } | null {
  if (!hasDeploymentIdentity) return null;
  return project?.lwqlKey ? { id: project.id, lwqlKey: project.lwqlKey } : null;
}
