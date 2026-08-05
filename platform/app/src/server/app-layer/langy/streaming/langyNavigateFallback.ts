/**
 * Verified server-side resolution for a navigate id the conversation never
 * remembered a platform link for.
 *
 * The per-conversation link store is an optimization — the id of a resource
 * the agent surfaced usually rides it. But legitimate flows miss the cache:
 * the model chains its lookup into a compound command (compound stdout is
 * never trusted for remembering), or surfaces runs through payloads that
 * carry no per-item platform link. The address here is STILL
 * platform-computed, never agent-authored: the resource is looked up with the
 * project's own access (tenancy-scoped service) and the URL built by the same
 * builder the public API uses. An id that doesn't resolve in this project
 * yields null — the navigate drops, exactly as an unknown destination should.
 *
 * One resolver per id prefix; a prefix this table doesn't know is not a
 * navigate target the fallback will ever invent.
 */
import { scenarioRunPlatformUrl } from "~/app/api/simulation-runs/scenario-run-platform-url";
import { getApp } from "~/server/app-layer/app";

export async function resolveNavigateFallbackUrl({
  projectId,
  resourceId,
}: {
  projectId: string;
  resourceId: string;
}): Promise<string | null> {
  if (!resourceId.startsWith("scenariorun_")) return null;

  const app = getApp();
  const run = await app.simulations.runs
    .getScenarioRunData({ projectId, scenarioRunId: resourceId })
    .catch(() => null);
  if (!run) return null;

  const project = await app.projects.getById(projectId).catch(() => null);
  if (!project?.slug) return null;

  return scenarioRunPlatformUrl({
    projectSlug: project.slug,
    scenarioRunId: resourceId,
  });
}
