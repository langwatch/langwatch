import type { TargetConfig } from "@langwatch/experiment-contract";

import type { LoadedCellRun } from "../features/run/services/experiment-run-cell.service.ts";
import { ExperimentRunSandboxKeyService } from "../features/run/services/experiment-run-sandbox-key.service.ts";
import type { ExperimentRunCollaborators } from "../rules/experiment-run-input.rules.ts";
import type { ExecutionDataServices } from "./experiment-execution-data.service.ts";
import { ExperimentTargetLoadingService } from "./experiment-target-loading.service.ts";

type ExperimentCellLoadDeps = {
  services: ExecutionDataServices;
  collaborators: ExperimentRunCollaborators;
};

/** Loads the targets a cell dispatches against, and the key lent to their code. */
export class ExperimentCellLoadService {
  static create(deps: ExperimentCellLoadDeps): ExperimentCellLoadService {
    return new ExperimentCellLoadService(deps);
  }

  private readonly targetLoading = ExperimentTargetLoadingService.create();
  private readonly sandboxKey = ExperimentRunSandboxKeyService.create();

  private constructor(private readonly deps: ExperimentCellLoadDeps) {}

  /** The run's targets a cell needs, as the run pinned them, and the key it lends their code. */
  async load({
    projectId,
    userId,
    targets,
    evaluators,
  }: {
    projectId: string;
    /** Who started the run; the key lent to its code acts as them, or as the system. */
    userId: string | null;
    targets: TargetConfig[];
    evaluators: { dbEvaluatorId?: string }[];
  }): Promise<LoadedCellRun> {
    const services = this.deps.services;
    const loadedPrompts = await this.targetLoading.loadPrompts({ projectId, targets, services });

    const loadedAgents = await this.targetLoading.loadAgents({ projectId, targets, services });

    const loadedWorkflows = await this.targetLoading.loadWorkflows({
      projectId,
      targets,
      services,
      loadedAgents,
    });

    const loadedEvaluators = await this.targetLoading.loadEvaluators({
      projectId,
      targets,
      evaluators,
      services,
    });

    const sandboxApiKey = await this.sandboxKey.findRunSandboxApiKey({
      sandboxCredentials: this.deps.collaborators.sandboxCredentials,
      projectId,
      userId,
      loadedAgents,
      loadedWorkflows,
    });

    return {
      loadedPrompts,
      loadedAgents,
      loadedWorkflows,
      loadedEvaluators,
      ...(sandboxApiKey ? { sandboxApiKey } : {}),
    };
  }
}
