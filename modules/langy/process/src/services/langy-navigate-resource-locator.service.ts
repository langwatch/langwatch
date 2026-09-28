/**
 * Finds a navigate id in its owning feature, with the asking project's own
 * access, and says where the product's own links open it. Nothing an agent
 * authored ever becomes the address.
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";

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

export class LangyNavigateResourceLocatorService {
  static create(input: {
    experiments: Pick<ExperimentApi, "findById">;
    agents: Pick<AgentApi, "getById" | "platformUrl">;
    publicBaseUrl: string | undefined;
  }): LangyNavigateResourceLocatorService {
    return new LangyNavigateResourceLocatorService(input);
  }

  readonly #experiments: Pick<ExperimentApi, "findById">;
  readonly #agents: Pick<AgentApi, "getById" | "platformUrl">;
  readonly #publicBaseUrl: string | undefined;

  private constructor(input: {
    experiments: Pick<ExperimentApi, "findById">;
    agents: Pick<AgentApi, "getById" | "platformUrl">;
    publicBaseUrl: string | undefined;
  }) {
    this.#experiments = input.experiments;
    this.#agents = input.agents;
    this.#publicBaseUrl = input.publicBaseUrl;
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
      case "dataset":
      case "workflow":
      case "monitor":
      case "evaluator":
      case "scenario":
      case "scenarioRun":
        // Their owners' contracts are not dependencies of this package yet.
        return Promise.resolve(UNKNOWN);
    }
  }

  async #experiment({
    projectId,
    resourceId,
  }: LocateInput): Promise<LangyNavigateResourceLocation> {
    const experiment = await this.#experiments.findById({ projectId, id: resourceId });
    if (!experiment) return UNKNOWN;
    // The experiment page reads slug or id; the slug is what the app's own links use.
    return this.#underProject(NAVIGATE_RESOURCE_PATHS.experiment(experiment.slug || experiment.id));
  }

  async #agent({ projectId, resourceId }: LocateInput): Promise<LangyNavigateResourceLocation> {
    try {
      const agent = await this.#agents.getById({ id: resourceId, projectId });
      return {
        outcome: "located",
        address: (projectSlug) =>
          Promise.resolve(
            this.#agents.platformUrl({ projectSlug, agentId: agent.id, agentType: agent.type }),
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
