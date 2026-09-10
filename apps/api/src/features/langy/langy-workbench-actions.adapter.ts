/** The experiments workbench, as Langy's page-action channel reaches it. */

/*
 * Two adapters over one feature: the CATALOGUE of dispatchable kinds, and the
 * SAVED-document half an away page is stood in for by. Both live here, the one
 * place that may hold the Langy channel and the experiment run loop at once.
 */
import {
  ExperimentSavedStateExecutionService,
  type ExperimentService,
} from "@langwatch/experiment-server";
import {
  type ExecutionScope,
  projectWorkbenchState,
  runPayloadSchema,
  scopeFromRunPayload,
  StaleWorkbenchStateError,
  type WorkbenchState,
  WORKBENCH_ACTIONS,
  getStatePayloadSchema,
} from "@langwatch/experiment-contract";
import {
  type LangyBackendActor,
  type LangyBackendRunResult,
  type LangyBackendSaveResult,
  type LangyBackendStateRead,
  LangyUiActionBackendPort,
  type LangyUiActionDefinition,
} from "@langwatch/langy-server";
import { LangyUiActionRestCatalogPort } from "@langwatch/langy-server";

import type { ApiExperimentRun } from "../../app/api-experiment-run.composition.ts";

/** The workbench half of this process's experiment feature, where it composed one. */
export type ApiLangyWorkbenchPeer = Readonly<{
  experiments: ExperimentService;
  run: ApiExperimentRun;
  /** The tenant's own slug, which a run's shareable link is built under. */
  trySlugOf(projectId: string): Promise<string | null>;
}>;

/**
 * Every page action this process serves. One page family exists — the
 * evaluations workbench — and its manifest is a framework-free contract module,
 * so the catalogue is the manifest read through the port's own shape.
 */
export class ApiWorkbenchUiActionCatalog extends LangyUiActionRestCatalogPort {
  static create(): ApiWorkbenchUiActionCatalog {
    return new ApiWorkbenchUiActionCatalog();
  }

  tryFind(kind: string): LangyUiActionDefinition | null {
    return kindsOf().find((entry) => entry.kind === kind)?.definition ?? null;
  }

  list(): readonly Readonly<{ kind: string; definition: LangyUiActionDefinition }>[] {
    return kindsOf();
  }
}

let catalogue: readonly Readonly<{ kind: string; definition: LangyUiActionDefinition }>[] | null =
  null;

function kindsOf(): readonly Readonly<{
  kind: string;
  definition: LangyUiActionDefinition;
}>[] {
  catalogue ??= Object.entries(WORKBENCH_ACTIONS).map(([kind, definition]) => ({
    kind,
    definition,
  }));
  return catalogue;
}

/**
 * The away fallback's saved document: the experiment the dispatch named, read,
 * rewritten and run through the same seams the CI run door uses.
 */
export class ApiWorkbenchUiActionBackend extends LangyUiActionBackendPort {
  static create(peer: ApiLangyWorkbenchPeer): ApiWorkbenchUiActionBackend {
    return new ApiWorkbenchUiActionBackend(peer);
  }

  private constructor(private readonly peer: ApiLangyWorkbenchPeer) {
    super();
  }

  async project({
    projectId,
    target,
    payload,
  }: {
    projectId: string;
    target: string;
    payload: unknown;
  }): Promise<{ version: number; projection: Record<string, unknown> }> {
    const current = await this.peer.experiments.getWorkbenchState({
      projectId,
      slug: target,
    });
    const parsed = getStatePayloadSchema.parse(payload);
    if (!current.state) {
      return { version: current.version, projection: { state: null } };
    }
    const state = current.state as unknown as WorkbenchState;
    // The columns named the way the run's own errors name them. Resolved here
    // because the projection is pure and a prompt handle lives in the database.
    const targetNames = await this.peer.run.resolveTargetNames({
      projectId,
      targets: state.targets,
    });
    const persistedResults = parsed.includeResults === false ? undefined : current.state.results;
    const projection = projectWorkbenchState({
      state,
      targetNames,
      // The saved snapshot has no transient status; "idle" says exactly that.
      ...(persistedResults ? { results: { status: "idle", ...persistedResults } } : {}),
    });
    return { version: current.version, projection };
  }

  async readState({
    projectId,
    target,
  }: {
    projectId: string;
    target: string;
  }): Promise<LangyBackendStateRead> {
    const current = await this.peer.experiments.getWorkbenchState({
      projectId,
      slug: target,
    });
    return {
      documentId: current.experimentId,
      version: current.version,
      state: current.state ?? null,
    };
  }

  async saveState({
    projectId,
    documentId,
    state,
    expectedVersion,
    actor,
    commitMessage,
  }: {
    projectId: string;
    documentId: string;
    state: unknown;
    expectedVersion: number;
    actor: LangyBackendActor;
    commitMessage: string;
  }): Promise<LangyBackendSaveResult> {
    try {
      const saved = await this.peer.experiments.saveWorkbenchState({
        projectId,
        id: documentId,
        state: state as never,
        expectedVersion,
        actor: { userId: actor.userId, label: "langy" },
        commitMessage,
      });
      return { saved: true, version: saved.version };
    } catch (error) {
      // A concurrent writer moved the document on. The channel replays the
      // transform over the fresh read rather than propagating a version race.
      if (error instanceof StaleWorkbenchStateError) {
        return { saved: false, reason: "stale" };
      }
      throw error;
    }
  }

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
    const parsed = runPayloadSchema.parse(payload);
    const prepared = await ExperimentSavedStateExecutionService.prepareSavedStateExecution({
      experiments: this.peer.experiments,
      services: this.peer.run.services,
      projectId,
      slug: target,
    });
    if ("error" in prepared) {
      return { started: false, refusal: prepared.error };
    }

    const scope: ExecutionScope = scopeFromRunPayload(parsed);
    const seedTargetOutputs = ExperimentSavedStateExecutionService.findSavedRunSeeding({
      prepared,
      scope,
    });
    // The board the run carries in, so a scoped run still holds every column.
    const carriedOverCells = ExperimentSavedStateExecutionService.planSavedRunCarryOver({
      prepared,
      scope,
    });
    const projectSlug = (await this.peer.trySlugOf(projectId)) ?? projectId;
    const { runId, total } = await this.peer.run.startRun({
      projectId,
      projectSlug,
      experimentId: prepared.experiment.id,
      experimentSlug: target,
      scope,
      state: prepared.state,
      datasetRows: prepared.datasetRows,
      datasetColumns: prepared.datasetColumns,
      loadedPrompts: prepared.loadedPrompts,
      loadedAgents: prepared.loadedAgents,
      loadedEvaluators: prepared.loadedEvaluators,
      loadedWorkflows: prepared.loadedWorkflows,
      // The saved cells the run reuses rather than recomputes. A comparison
      // judging this column against another one reads the other one from here.
      ...(seedTargetOutputs ? { seedTargetOutputs } : {}),
      // Every cell the run does not cover, copied from the saved board, so
      // opening the run shows the board rather than one column.
      ...(carriedOverCells.length > 0 ? { carriedOverCells } : {}),
      // The run evaluates the saved dataset, so its cells belong in the saved
      // state: without this the page the assistant is working for still reads
      // "No output yet" after the run finishes.
      persistResults: {
        experiments: this.peer.experiments,
        actor: { userId: actor.userId, label: "langy" },
      },
    });
    return { started: true, runId, total };
  }
}
