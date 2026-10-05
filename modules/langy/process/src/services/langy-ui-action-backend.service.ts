import {
  LangyUiExperimentRequiredError,
  LangyUiHandlerFailedError,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";

import { extractTransformRefusalCode } from "../rules/langy-ui-action-refusal.rules.ts";
import { LangyExplorerActionService } from "./langy-explorer-action.service.ts";
import type { LangyUiActionDefinition } from "./langy-ui-action-catalog.service.ts";
import type { UiActionBackendRunner } from "./langy-ui-action.service.ts";

/** Who a backend edit is recorded as. */
export type LangyBackendActor = Readonly<{ userId: string; label: string }>;

/** The document a transform rewrites, at the version it was read at. */
export type LangyBackendStateRead = Readonly<{
  /** The row a save is addressed to, which a slug alone does not name. */
  documentId: string;
  version: number;
  /** `null` when the target exists but holds no state yet. */
  state: unknown;
}>;

/**
 * A save either lands, or a concurrent writer moved the document on. The stale
 * branch is a value rather than a thrown error so this package classifies none
 * of another feature's failures.
 */
export type LangyBackendSaveResult =
  | Readonly<{ saved: true; version: number }>
  | Readonly<{ saved: false; reason: "stale" }>;

/** A run either starts, or the saved document refuses it by name. */
export type LangyBackendRunResult =
  | Readonly<{ started: true; runId: string; total: number }>
  | Readonly<{ started: false; refusal: string }>;

export interface LangyUiActionBackend {
  /**
   * The board as an agent reads it, from the saved document, with the version
   * that projection was taken at.
   */
  project(args: {
    projectId: string;
    target: string;
    payload: unknown;
  }): Promise<{ version: number; projection: Record<string, unknown> }>;

  readState(args: { projectId: string; target: string }): Promise<LangyBackendStateRead>;

  saveState(args: {
    projectId: string;
    documentId: string;
    state: unknown;
    expectedVersion: number;
    actor: LangyBackendActor;
    commitMessage: string;
  }): Promise<LangyBackendSaveResult>;

  /** Starts the run the open page would have started, over the saved document. */
  startRun(args: {
    projectId: string;
    target: string;
    payload: unknown;
    actor: LangyBackendActor;
  }): Promise<LangyBackendRunResult>;
}

/**
 * How an away page is stood in for: the saved document is read, rewritten by
 * the action's own transform, or run.
 */
export type LangyUiActionBackendMode = "read" | "transform" | "run";

/**
 * The away-fallback half of the UI-action channel: the same action kinds the
 * open page executes, applied to the SAVED document through the backend port.
 * @see specs/langy/langy-ui-actions-fallback.feature
 */

/*
 * Which document to touch comes from the dispatch request (`--experiment
 * <slug>` on the CLI): the browser path never needs it because the open page IS
 * the document, so the field is fallback-only and its absence is a refusal.
 */

const logger = createLogger("langwatch:langy:ui-actions:backend");

/** How a Langy edit is attributed in the saved document's history. */
const LANGY_ACTOR_LABEL = "langy";

export type LangyUiActionBackendServiceDependencies = {
  backend: LangyUiActionBackend;
  /** The tenant's slug an away link is built from, for a runner handed only the project id. */
  projects?: Pick<ProjectApi, "findIdentity">;
  /** The Trace Explorer's away form, which writes no document. */
  explorer?: LangyExplorerActionService;
};

export class LangyUiActionBackendService {
  static create(deps: LangyUiActionBackendServiceDependencies): LangyUiActionBackendService {
    return new LangyUiActionBackendService(deps);
  }

  private readonly backend: LangyUiActionBackend;
  private readonly explorer: LangyExplorerActionService;
  private readonly projects: Pick<ProjectApi, "findIdentity"> | undefined;

  private constructor(deps: LangyUiActionBackendServiceDependencies) {
    this.backend = deps.backend;
    this.projects = deps.projects;
    this.explorer = deps.explorer ?? LangyExplorerActionService.create();
  }

  /** The channel's away fallback: the same run, with the project's slug looked up first. */
  readonly runner: UiActionBackendRunner = async (args) => {
    const project = await this.projects?.findIdentity(args.projectId);
    return this.run({ ...args, projectSlug: project?.slug ?? args.projectId });
  };

  /** Runs one dispatched action against the saved document. */
  async run({
    projectId,
    projectSlug,
    userId,
    kind,
    definition,
    payload,
    experimentSlug,
  }: {
    projectId: string;
    /** The tenant's address, which is what an away link is built from. */
    projectSlug: string;
    userId: string;
    kind: string;
    definition: LangyUiActionDefinition;
    payload: unknown;
    experimentSlug?: string;
  }): Promise<unknown> {
    // The Explorer has no saved document to edit, so its away form is a link
    // rather than a write, and it needs no experiment named.
    if (this.explorer.isExplorerKind(kind)) {
      return this.explorer.run({ projectSlug, kind, payload });
    }

    if (!experimentSlug) {
      throw new LangyUiExperimentRequiredError(kind);
    }

    const actor: LangyBackendActor = { userId, label: LANGY_ACTOR_LABEL };

    switch (definition.backend) {
      case "read": {
        // "saved" is what tells the agent it is reading the document rather
        // than an open page, and the version is what a later edit is checked
        // against.
        const read = await this.backend.project({
          projectId,
          target: experimentSlug,
          payload,
        });

        return { source: "saved", version: read.version, ...read.projection };
      }
      case "transform":
        return this.applyTransform({
          projectId,
          kind,
          definition,
          payload,
          target: experimentSlug,
          actor,
        });
      case "run":
        return this.startRun({
          projectId,
          kind,
          payload,
          target: experimentSlug,
          actor,
        });
      default:
        throw new LangyUiHandlerFailedError(kind);
    }
  }

  private async applyTransform({
    projectId,
    kind,
    definition,
    payload,
    target,
    actor,
    isRetry = false,
  }: {
    projectId: string;
    kind: string;
    definition: LangyUiActionDefinition;
    payload: unknown;
    target: string;
    actor: LangyBackendActor;
    isRetry?: boolean;
  }): Promise<unknown> {
    const transform = definition.transform;
    if (!transform) {
      throw new LangyUiHandlerFailedError(kind);
    }

    const current = await this.backend.readState({ projectId, target });
    if (!current.state) {
      throw new LangyUiHandlerFailedError(kind, "empty_state");
    }

    let applied: { state: unknown; result?: unknown };
    try {
      applied = transform({ state: current.state, payload });
    } catch (error) {
      const refusal = extractTransformRefusalCode(error);
      if (refusal) {
        throw new LangyUiHandlerFailedError(kind, refusal);
      }

      throw error;
    }

    const saved = await this.backend.saveState({
      projectId,
      documentId: current.documentId,
      state: applied.state,
      expectedVersion: current.version,
      actor,
      commitMessage: `Applied ${kind}`,
    });
    if (saved.saved) {
      return { ...asRecord(applied.result), version: saved.version };
    }

    // One retry on a concurrent write: re-read, re-apply, re-save. The
    // transform is pure, so replaying it over the fresh state is exactly what
    // a second attempt by hand would do. A second stale answer propagates.
    if (isRetry) {
      throw new LangyUiHandlerFailedError(kind, "stale_state");
    }

    logger.info({ kind, target }, "stale save, retrying transform once");

    return this.applyTransform({
      projectId,
      kind,
      definition,
      payload,
      target,
      actor,
      isRetry: true,
    });
  }

  private async startRun({
    projectId,
    kind,
    payload,
    target,
    actor,
  }: {
    projectId: string;
    kind: string;
    payload: unknown;
    target: string;
    actor: LangyBackendActor;
  }): Promise<unknown> {
    const started = await this.backend.startRun({
      projectId,
      target,
      payload,
      actor,
    });
    if (!started.started) {
      throw new LangyUiHandlerFailedError(kind, started.refusal);
    }

    return { runId: started.runId, status: "running", total: started.total };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}
