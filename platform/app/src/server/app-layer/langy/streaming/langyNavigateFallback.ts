/**
 * Verified server-side resolution for a navigate id the conversation never
 * remembered a platform link for.
 *
 * The per-conversation link store is an optimization: the id of a resource
 * the agent surfaced usually rides it. But legitimate flows miss the cache:
 * the model chains its lookup into a compound command (compound stdout is
 * never trusted for remembering), or surfaces runs through payloads that
 * carry no per-item platform link. The address here is STILL
 * platform-computed, never agent-authored: the resource is looked up with the
 * project's own access (tenancy-scoped service, `projectId` always in the
 * lookup) and the URL built by the same builder the public API uses. An id
 * that doesn't resolve in this project yields null: the navigate drops,
 * exactly as an unknown destination should.
 *
 * One resolver per id prefix; a prefix this table doesn't know is not a
 * navigate target the fallback will ever invent. Each resolver returns a
 * project-slug→URL builder on a hit (the slug is fetched once, after the
 * resource is confirmed to exist) or null on a miss; any lookup error also
 * resolves to null rather than tearing down the relay stream.
 */
import { agentPlatformUrl } from "~/app/api/agents/agent-platform-url";
import { platformUrl } from "~/app/api/shared/platform-url";
import { scenarioRunPlatformUrl } from "~/app/api/simulation-runs/scenario-run-platform-url";
import { AgentService } from "~/server/agents/agent.service";
import { getApp } from "~/server/app-layer/app";
import { DatasetService } from "~/server/datasets/dataset.service";
import { prisma } from "~/server/db";
import { EvaluatorService } from "~/server/evaluators/evaluator.service";
import { PromptService } from "~/server/prompt-config/prompt.service";

type UrlForProjectSlug = (projectSlug: string) => string;

/**
 * Look one id up with the project's own access; on a hit, return how to build
 * its platform URL from the project slug. Null = not resolvable here.
 */
type NavigateResolver = (a: {
  projectId: string;
  resourceId: string;
}) => Promise<UrlForProjectSlug | null>;

/** The prompts page (the playground) with that prompt's editor drawer open:
 * the same address the app's own UI produces via
 * `openDrawer("promptEditor", { promptId })` (see `drawerRegistry.ts`). */
const promptPath = (promptId: string): string =>
  `/prompts?drawer.open=promptEditor&drawer.promptId=${encodeURIComponent(promptId)}`;

/** Same drawer address the monitors REST API hands out as `platformUrl`. */
const monitorPath = (monitorId: string): string =>
  `/online-evaluations?drawer.open=onlineEvaluation&drawer.monitorId=${encodeURIComponent(monitorId)}`;

/** Same drawer address the evaluators REST API hands out as `platformUrl`. */
const evaluatorPath = (evaluatorId: string): string =>
  `/evaluators?drawer.open=evaluatorEditor&drawer.evaluatorId=${encodeURIComponent(evaluatorId)}`;

/**
 * Every id prefix `langwatch navigate open <id>` can resolve without a
 * remembered link, mapped to its tenancy-scoped lookup and the platform's own
 * address for the resource: the same paths the REST APIs hand out as
 * `platformUrl` (datasets, workflows/studio, monitors, evaluators, agents,
 * scenario runs) or the app's own drawer deep links (prompts). Order is not
 * significant: no prefix here is a prefix of another. (`prompt_version_` ids
 * fall into `prompt_` and miss the prompt lookup, correctly dropping.)
 */
const NAVIGATE_RESOLVERS: Record<string, NavigateResolver> = {
  scenariorun_: async ({ projectId, resourceId }) => {
    const run = await getApp().simulations.runs.getScenarioRunData({
      projectId,
      scenarioRunId: resourceId,
    });
    if (!run) return null;
    return (projectSlug) =>
      scenarioRunPlatformUrl({ projectSlug, scenarioRunId: resourceId });
  },

  prompt_: async ({ projectId, resourceId }) => {
    const prompt = await new PromptService(prisma).getPromptByIdOrHandle({
      idOrHandle: resourceId,
      projectId,
    });
    if (!prompt) return null;
    return (projectSlug) =>
      platformUrl({ projectSlug, path: promptPath(prompt.id) });
  },

  dataset_: async ({ projectId, resourceId }) => {
    // Throws DatasetNotFoundError on a miss; the caller maps any throw to null.
    const dataset = await DatasetService.create(prisma).getBySlugOrId({
      slugOrId: resourceId,
      projectId,
    });
    return (projectSlug) =>
      platformUrl({
        projectSlug,
        path: `/datasets/${encodeURIComponent(dataset.id)}`,
      });
  },

  workflow_: async ({ projectId, resourceId }) => {
    const workflow = await prisma.workflow.findFirst({
      where: { id: resourceId, projectId, archivedAt: null },
      select: { id: true },
    });
    if (!workflow) return null;
    return (projectSlug) =>
      platformUrl({
        projectSlug,
        path: `/studio/${encodeURIComponent(workflow.id)}`,
      });
  },

  experiment_: async ({ projectId, resourceId }) => {
    const experiment = await getApp().experiments.findById({
      projectId,
      id: resourceId,
    });
    if (!experiment) return null;
    // The experiment page resolves slug or id; the slug is what the app's own
    // links use.
    const target = experiment.slug || experiment.id;
    return (projectSlug) =>
      platformUrl({
        projectSlug,
        path: `/experiments/${encodeURIComponent(target)}`,
      });
  },

  monitor_: async ({ projectId, resourceId }) => {
    const monitor = await prisma.monitor.findFirst({
      where: { id: resourceId, projectId },
      select: { id: true },
    });
    if (!monitor) return null;
    return (projectSlug) =>
      platformUrl({ projectSlug, path: monitorPath(monitor.id) });
  },

  evaluator_: async ({ projectId, resourceId }) => {
    const evaluator = await EvaluatorService.create(prisma).getById({
      id: resourceId,
      projectId,
    });
    if (!evaluator) return null;
    return (projectSlug) =>
      platformUrl({ projectSlug, path: evaluatorPath(evaluator.id) });
  },

  agent_: async ({ projectId, resourceId }) => {
    // Throws AgentNotFoundError on a miss; the caller maps any throw to null.
    const agent = await AgentService.create(prisma).getByIdOrThrow({
      id: resourceId,
      projectId,
    });
    return (projectSlug) =>
      agentPlatformUrl({
        projectSlug,
        agentId: agent.id,
        agentType: agent.type,
      });
  },
};

export async function resolveNavigateFallbackUrl({
  projectId,
  resourceId,
}: {
  projectId: string;
  resourceId: string;
}): Promise<string | null> {
  const resolver = Object.entries(NAVIGATE_RESOLVERS).find(([prefix]) =>
    resourceId.startsWith(prefix),
  )?.[1];
  if (!resolver) return null;

  const buildUrl = await resolver({ projectId, resourceId }).catch(() => null);
  if (!buildUrl) return null;

  const project = await getApp()
    .projects.getById(projectId)
    .catch(() => null);
  if (!project?.slug) return null;

  return buildUrl(project.slug);
}
