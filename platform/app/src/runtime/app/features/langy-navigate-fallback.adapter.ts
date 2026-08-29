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
 * One resolver per id prefix, plus a closed table of page destinations; a
 * name neither table knows is not a navigate target the fallback will ever
 * invent. Each resolver returns a project-slug→URL builder on a hit (the slug
 * is fetched once, after the resource is confirmed to exist) or null on a
 * miss; any lookup error also resolves to null rather than tearing down the
 * relay stream.
 */
import { agentPlatformUrl } from "~/app/api/agents/agent-platform-url";
import { platformUrl } from "~/app/api/shared/platform-url";
import { scenarioRunPlatformUrl } from "~/app/api/simulation-runs/scenario-run-platform-url";
import type { AgentService } from "@langwatch/agent-contract";
import type { DatasetService } from "@langwatch/dataset-contract";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { ExperimentService } from "@langwatch/experiment-contract";
import type { MonitorService } from "@langwatch/monitor-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { PromptService } from "@langwatch/prompt-contract";
import type { SimulationService } from "@langwatch/scenario-contract";
import type { WorkflowService } from "@langwatch/workflow-contract";

/**
 * The services this resolver reads, named directly rather than derived from
 * `RequestAppServices`.
 *
 * It is built at composition time, before the `App` exists, and it asks each
 * one a single lookup. Deriving the type from the App class made it demand
 * the feature APPLICATIONS the moment those keys held one, which nothing at
 * this point in composition has yet built.
 */
type LangyNavigateFallbackServices = {
  simulations: Pick<SimulationService, "tryGetScenarioRunData">;
  prompts: Pick<PromptService, "tryGetPromptByIdOrHandle">;
  dataset: Pick<DatasetService, "getBySlugOrId">;
  workflows: Pick<WorkflowService, "getById">;
  experiments: Pick<ExperimentService, "tryGetById">;
  monitors: Pick<MonitorService, "tryGetMonitorById">;
  evaluators: Pick<EvaluatorService, "tryGetById">;
  agents: Pick<AgentService, "getById">;
  projects: Pick<ProjectService, "tryGetById">;
};

type UrlForProjectSlug = (projectSlug: string) => string;

/**
 * Page destinations `langwatch navigate open <page>` can name directly: the
 * project's own top-level pages, for "take me to the prompts page" asks that
 * name no single resource. Static paths under the project slug, so no lookup
 * beyond the project itself is needed and tenancy holds by construction. The
 * keys are the canonical names AGENTS.md documents; anything else still goes
 * through the id-prefix table below (page names contain no underscore, so the
 * two namespaces cannot collide).
 */
const NAVIGATE_PAGES: Record<string, string> = {
  prompts: "/prompts",
  datasets: "/datasets",
  evaluations: "/evaluations",
  "online-evaluations": "/online-evaluations",
  evaluators: "/evaluators",
  traces: "/traces",
  simulations: "/simulations",
  experiments: "/experiments",
  workflows: "/workflows",
  agents: "/agents",
  analytics: "/analytics",
  annotations: "/annotations",
  automations: "/automations",
};

/**
 * Look one id up with the project's own access; on a hit, return how to build
 * its platform URL from the project slug. Null = not resolvable here.
 */
type NavigateResolver = (a: {
  services: LangyNavigateFallbackServices;
  projectId: string;
  resourceId: string;
}) => Promise<UrlForProjectSlug | null>;

/**
 * The playground with that prompt OPEN AS A TAB (`useUrlParamToOpenNewTab`).
 *
 * This used to open the editor drawer instead, which stacked a form over the
 * playground's own "no prompts open" empty state: the page behind the drawer
 * was blank, and the one place in the product built for reading a prompt and
 * running it was the thing the drawer covered. A tab is the playground's own
 * way to open a prompt, so the reader lands where they can try it.
 */
const promptPath = (promptId: string): string =>
  `/prompts?promptId=${encodeURIComponent(promptId)}`;

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
  scenariorun_: async ({ services, projectId, resourceId }) => {
    const run = await services.simulations.tryGetScenarioRunData({
      projectId,
      scenarioRunId: resourceId,
    });
    if (!run) return null;
    return (projectSlug) =>
      scenarioRunPlatformUrl({ projectSlug, scenarioRunId: resourceId });
  },

  prompt_: async ({ services, projectId, resourceId }) => {
    const prompt = await services.prompts.tryGetPromptByIdOrHandle({
      idOrHandle: resourceId,
      projectId,
    });
    if (!prompt) return null;
    return (projectSlug) => platformUrl({ projectSlug, path: promptPath(prompt.id) });
  },

  dataset_: async ({ services, projectId, resourceId }) => {
    // Throws DatasetNotFoundError on a miss; the caller maps any throw to null.
    const dataset = await services.dataset.getBySlugOrId({
      slugOrId: resourceId,
      projectId,
    });
    return (projectSlug) =>
      platformUrl({
        projectSlug,
        path: `/datasets/${encodeURIComponent(dataset.id)}`,
      });
  },

  workflow_: async ({ services, projectId, resourceId }) => {
    const workflow = await services.workflows
      .getById({ id: resourceId, projectId, includeVersion: false })
      .catch(() => null);
    if (!workflow) return null;
    return (projectSlug) =>
      platformUrl({
        projectSlug,
        path: `/studio/${encodeURIComponent(workflow.id)}`,
      });
  },

  experiment_: async ({ services, projectId, resourceId }) => {
    const experiment = await services.experiments.tryGetById({
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

  monitor_: async ({ services, projectId, resourceId }) => {
    const monitor = await services.monitors.tryGetMonitorById({
      projectId,
      id: resourceId,
    });
    if (!monitor) return null;
    return (projectSlug) => platformUrl({ projectSlug, path: monitorPath(monitor.id) });
  },

  evaluator_: async ({ services, projectId, resourceId }) => {
    const evaluator = await services.evaluators.tryGetById({
      id: resourceId,
      projectId,
    });
    if (!evaluator) return null;
    return (projectSlug) =>
      platformUrl({ projectSlug, path: evaluatorPath(evaluator.id) });
  },

  agent_: async ({ services, projectId, resourceId }) => {
    // Throws AgentNotFoundError on a miss; the caller maps any throw to null.
    const agent = await services.agents.getById({
      id: resourceId,
      projectId,
    });
    if (!agent) return null;
    return (projectSlug) =>
      agentPlatformUrl({
        projectSlug,
        agentId: agent.id,
        agentType: agent.type,
      });
  },
};

/**
 * The page or resource this id names, as a builder that still needs the
 * project slug. Page names are matched case-insensitively (they are words the
 * agent types); id prefixes are matched on the raw string, because an id is
 * case-sensitive and lowercasing one would resolve an id that does not exist.
 */
async function resolveUrlBuilder({
  services,
  projectId,
  resourceId,
}: {
  services: LangyNavigateFallbackServices;
  projectId: string;
  resourceId: string;
}): Promise<((projectSlug: string) => string) | null> {
  const pagePath = NAVIGATE_PAGES[resourceId.toLowerCase()];
  if (pagePath) {
    return (projectSlug: string) => platformUrl({ projectSlug, path: pagePath });
  }
  const resolver = Object.entries(NAVIGATE_RESOLVERS).find(([prefix]) =>
    resourceId.startsWith(prefix),
  )?.[1];
  if (!resolver) return null;
  return resolver({ services, projectId, resourceId }).catch(() => null);
}

export class AppLangyNavigateFallbackAdapter {
  private constructor(private readonly services: LangyNavigateFallbackServices) {}

  static create(
    services: LangyNavigateFallbackServices,
  ): AppLangyNavigateFallbackAdapter {
    return new AppLangyNavigateFallbackAdapter(services);
  }

  async resolve(input: {
    projectId: string;
    resourceId: string;
  }): Promise<string | null> {
    const buildUrl = await resolveUrlBuilder({ services: this.services, ...input });
    if (!buildUrl) return null;

    const project = await this.services.projects
      .tryGetById(input.projectId)
      .catch(() => null);
    return project?.slug ? buildUrl(project.slug) : null;
  }
}
