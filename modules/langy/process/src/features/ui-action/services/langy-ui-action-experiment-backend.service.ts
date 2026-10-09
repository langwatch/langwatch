import { type ExperimentApi, getStatePayloadSchema } from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";
import type { ProjectApi } from "@langwatch/project-contract";

import type {
  LangyBackendActor,
  LangyBackendRunResult,
  LangyBackendSaveResult,
  LangyBackendStateRead,
  LangyUiActionBackend,
} from "./langy-ui-action-backend.service.ts";

type Experiments = Pick<
  ExperimentApi,
  "getWorkbenchState" | "projectSavedWorkbench" | "saveWorkbenchState" | "startSavedRun"
>;

/** Whether a save lost to a concurrent writer: the stale code, read off the handled payload. */
function isStaleSave(error: unknown): boolean {
  return HandledError.isHandled(error) && error.code === "experiment_stale_workbench_state";
}

/**
 * The away page's stand-in: the SAVED workbench, read, rewritten or run through experiment's own
 * operations. Edits are recorded as the dispatching agent's user; a run starts as the worker's
 * session key would start it from the CLI.
 */
export class LangyUiActionExperimentBackendService implements LangyUiActionBackend {
  static create(peers: {
    experiments: Experiments;
    projects: Pick<ProjectApi, "findIdentity">;
  }): LangyUiActionExperimentBackendService {
    return new LangyUiActionExperimentBackendService(peers);
  }

  private constructor(
    private readonly peers: {
      experiments: Experiments;
      projects: Pick<ProjectApi, "findIdentity">;
    },
  ) {}

  /** The saved board as an agent reads it, projected by experiment at the version it read. */
  async project({
    projectId,
    target,
    payload,
  }: {
    projectId: string;
    target: string;
    payload: unknown;
  }): Promise<{ version: number; projection: Record<string, unknown> }> {
    const { includeResults } = getStatePayloadSchema.parse(payload);
    const { version, ...projection } = await this.peers.experiments.projectSavedWorkbench({
      projectId,
      slug: target,
      includeResults,
    });
    return { version, projection };
  }

  async readState({
    projectId,
    target,
  }: {
    projectId: string;
    target: string;
  }): Promise<LangyBackendStateRead> {
    const current = await this.peers.experiments.getWorkbenchState({ projectId, slug: target });
    return { documentId: current.experimentId, version: current.version, state: current.state };
  }

  /** A concurrent writer answers `stale` as a value, so the caller decides whether to retry. */
  async saveState(input: {
    projectId: string;
    documentId: string;
    state: unknown;
    expectedVersion: number;
    actor: LangyBackendActor;
    commitMessage: string;
  }): Promise<LangyBackendSaveResult> {
    try {
      const saved = await this.peers.experiments.saveWorkbenchState(
        {
          projectId: input.projectId,
          id: input.documentId,
          state: input.state,
          expectedVersion: input.expectedVersion,
          commitMessage: input.commitMessage,
        },
        { kind: "user", id: input.actor.userId },
      );
      return { saved: true, version: saved.version };
    } catch (error) {
      if (isStaleSave(error)) return { saved: false, reason: "stale" };
      throw error;
    }
  }

  /** The run the open page would have started, over the saved document. */
  async startRun({
    projectId,
    target,
    payload,
    actor,
  }: {
    projectId: string;
    target: string;
    payload: unknown;
    actor: LangyBackendActor;
  }): Promise<LangyBackendRunResult> {
    const project = await this.peers.projects.findIdentity(projectId);
    const answer = await this.peers.experiments.startSavedRun({
      projectId,
      projectSlug: project?.slug ?? projectId,
      slug: target,
      body: JSON.stringify(payload ?? {}),
      acceptsEvents: false,
      credential: { kind: "apiKey", userId: actor.userId, isLangySessionKey: true },
    });
    if (answer.kind !== "started") return { started: false, refusal: "run_not_started" };
    return { started: true, runId: answer.runId, total: answer.total };
  }
}
