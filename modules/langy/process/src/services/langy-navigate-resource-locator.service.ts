/**
 * Finds a navigate id in its owning feature, with the asking project's own
 * access, and says where the product's own links open it. Nothing an agent
 * authored ever becomes the address.
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";

import {
  type LangyNavigateResourceKind,
  NAVIGATE_RESOURCE_PATHS,
} from "../rules/langy-navigate-resources.rules.ts";
import { langyProjectPlatformUrl } from "../rules/langy-platform-url.rules.ts";

/** Where a resource opens once the project slug is known, or `unknown` when nothing answers. */
export type LangyNavigateResourceLocation =
  | { outcome: "located"; address: (projectSlug: string) => Promise<string> }
  | { outcome: "unknown" };

const UNKNOWN: LangyNavigateResourceLocation = { outcome: "unknown" };

type LocateInput = { projectId: string; resourceId: string };

/** The one read each owning feature lends the locator, and nothing wider. */
type LocatorPeers = {
  experiments: Pick<ExperimentApi, "findById">;
  agents: Pick<AgentApi, "getById" | "platformUrl">;
  prompts: Pick<PromptApi, "findByIdOrHandle">;
  datasets: Pick<DatasetApi, "findBySlugOrId">;
  workflows: Pick<WorkflowApi, "getById">;
  monitors: Pick<MonitorApi, "findById">;
  evaluators: Pick<EvaluatorApi, "findById">;
  scenarios: Pick<ScenarioApi, "getById" | "findScenarioRunData" | "platformUrl">;
};

export class LangyNavigateResourceLocatorService {
  static create(
    input: LocatorPeers & { publicBaseUrl: string | undefined },
  ): LangyNavigateResourceLocatorService {
    return new LangyNavigateResourceLocatorService(input);
  }

  readonly #peers: LocatorPeers;
  readonly #publicBaseUrl: string | undefined;

  private constructor({
    publicBaseUrl,
    ...peers
  }: LocatorPeers & { publicBaseUrl: string | undefined }) {
    this.#peers = peers;
    this.#publicBaseUrl = publicBaseUrl;
  }

  locate(
    input: LocateInput & { kind: LangyNavigateResourceKind },
  ): Promise<LangyNavigateResourceLocation> {
    switch (input.kind) {
      case "experiment":
        return this.#experiment(input);
      case "agent":
        return this.#agent(input);
      case "prompt":
        return this.#prompt(input);
      case "dataset":
        return this.#dataset(input);
      case "workflow":
        return this.#workflow(input);
      case "monitor":
        return this.#monitor(input);
      case "evaluator":
        return this.#evaluator(input);
      case "scenario":
        return this.#scenario(input);
      case "scenarioRun":
        return this.#scenarioRun(input);
    }
  }

  async #prompt({ projectId, resourceId }: LocateInput): Promise<LangyNavigateResourceLocation> {
    const prompt = await this.#peers.prompts.findByIdOrHandle({
      idOrHandle: resourceId,
      projectId,
    });
    if (!prompt) return UNKNOWN;
    return this.#underProject(NAVIGATE_RESOURCE_PATHS.prompt(prompt.id));
  }

  async #dataset({ projectId, resourceId }: LocateInput): Promise<LangyNavigateResourceLocation> {
    const dataset = await this.#peers.datasets.findBySlugOrId({ slugOrId: resourceId, projectId });
    if (!dataset) return UNKNOWN;
    return this.#underProject(NAVIGATE_RESOURCE_PATHS.dataset(dataset.id));
  }

  /** An archived workflow reads as missing, as it does in the studio's own list. */
  async #workflow({ projectId, resourceId }: LocateInput): Promise<LangyNavigateResourceLocation> {
    try {
      const workflow = await this.#peers.workflows.getById({ id: resourceId, projectId });
      return this.#underProject(NAVIGATE_RESOURCE_PATHS.workflow(workflow.id));
    } catch (error) {
      if (HandledError.isHandled(error) && error.code === "workflow_not_found") return UNKNOWN;
      throw error;
    }
  }

  async #monitor({ projectId, resourceId }: LocateInput): Promise<LangyNavigateResourceLocation> {
    const monitor = await this.#peers.monitors.findById({ id: resourceId, projectId });
    if (!monitor) return UNKNOWN;
    return this.#underProject(NAVIGATE_RESOURCE_PATHS.monitor(monitor.id));
  }

  async #evaluator({ projectId, resourceId }: LocateInput): Promise<LangyNavigateResourceLocation> {
    const evaluator = await this.#peers.evaluators.findById({ id: resourceId, projectId });
    if (!evaluator) return UNKNOWN;
    return this.#underProject(NAVIGATE_RESOURCE_PATHS.evaluator(evaluator.id));
  }

  async #scenario({ projectId, resourceId }: LocateInput): Promise<LangyNavigateResourceLocation> {
    try {
      const scenario = await this.#peers.scenarios.getById({ id: resourceId, projectId });
      return this.#scenarioAddress({ projectId, resource: { scenarioId: scenario.id } });
    } catch (error) {
      if (HandledError.isHandled(error) && error.code === "scenario_not_found") return UNKNOWN;
      throw error;
    }
  }

  async #scenarioRun({
    projectId,
    resourceId,
  }: LocateInput): Promise<LangyNavigateResourceLocation> {
    const run = await this.#peers.scenarios.findScenarioRunData({
      projectId,
      scenarioRunId: resourceId,
    });
    if (!run) return UNKNOWN;
    return this.#scenarioAddress({ projectId, resource: { scenarioRunId: resourceId } });
  }

  /** Scenarios and runs open where the scenario module says, in the interface the project reads. */
  #scenarioAddress({
    projectId,
    resource,
  }: Pick<
    Parameters<ScenarioApi["platformUrl"]>[0],
    "projectId" | "resource"
  >): LangyNavigateResourceLocation {
    return {
      outcome: "located",
      address: (projectSlug) =>
        this.#peers.scenarios.platformUrl({ projectId, projectSlug, resource }),
    };
  }

  async #experiment({
    projectId,
    resourceId,
  }: LocateInput): Promise<LangyNavigateResourceLocation> {
    const experiment = await this.#peers.experiments.findById({ projectId, id: resourceId });
    if (!experiment) return UNKNOWN;
    // The experiment page reads slug or id; the slug is what the app's own links use.
    return this.#underProject(NAVIGATE_RESOURCE_PATHS.experiment(experiment.slug || experiment.id));
  }

  async #agent({ projectId, resourceId }: LocateInput): Promise<LangyNavigateResourceLocation> {
    try {
      const agent = await this.#peers.agents.getById({ id: resourceId, projectId });
      return {
        outcome: "located",
        address: (projectSlug) =>
          Promise.resolve(
            this.#peers.agents.platformUrl({
              projectSlug,
              agentId: agent.id,
              agentType: agent.type,
            }),
          ),
      };
    } catch (error) {
      if (HandledError.isHandled(error) && error.code === "agent_not_found") return UNKNOWN;
      throw error;
    }
  }

  #underProject(path: string): LangyNavigateResourceLocation {
    const publicBaseUrl = this.#publicBaseUrl;
    return {
      outcome: "located",
      address: (projectSlug) =>
        Promise.resolve(langyProjectPlatformUrl({ publicBaseUrl, projectSlug, path })),
    };
  }
}
