/** The saved document one page family keeps, as the away fallback needs it. */

/*
 * A port rather than an import, for the reason the catalogue port gives: the
 * saved state a page action rewrites belongs to the experiments workbench.
 */

/*
 * Everything workbench-shaped — which experiment a slug names, how a board is
 * projected, what a run's scope is — lives behind these four methods.
 */

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

export abstract class LangyUiActionBackendPort {
  /**
   * The board as an agent reads it, from the saved document, with the version
   * that projection was taken at.
   */
  abstract project(args: {
    projectId: string;
    target: string;
    payload: unknown;
  }): Promise<{ version: number; projection: Record<string, unknown> }>;

  abstract readState(args: { projectId: string; target: string }): Promise<LangyBackendStateRead>;

  abstract saveState(args: {
    projectId: string;
    documentId: string;
    state: unknown;
    expectedVersion: number;
    actor: LangyBackendActor;
    commitMessage: string;
  }): Promise<LangyBackendSaveResult>;

  /** Starts the run the open page would have started, over the saved document. */
  abstract startRun(args: {
    projectId: string;
    target: string;
    payload: unknown;
    actor: LangyBackendActor;
  }): Promise<LangyBackendRunResult>;
}
