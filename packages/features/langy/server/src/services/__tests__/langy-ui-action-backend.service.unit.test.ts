/**
 * The backend half of the UI-action channel: the same transforms the page runs,
 * applied to the SAVED document through the backend port
 * (specs/langy/langy-ui-actions-fallback.feature).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type LangyBackendActor,
  type LangyBackendRunResult,
  type LangyBackendSaveResult,
  type LangyBackendStateRead,
  LangyUiActionBackendPort,
} from "../../ports/langy-ui-action-backend.port";
import type { LangyUiActionDefinition } from "../../ports/langy-ui-action-catalog.port";
import { LangyUiActionBackendService } from "../langy-ui-action-backend.service";

/** A saved board with one column, small enough to read in a diff. */
const savedState = () => ({ name: "My experiment", targets: [{ id: "target-1" }] });

/** The refusal a page family's own transform throws, as it throws it. */
class TransformError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "TransformError";
    this.code = code;
  }
}

class FakeBackend extends LangyUiActionBackendPort {
  version = 4;
  staleSaves = 0;
  readonly saves: Array<{
    expectedVersion: number;
    actor: LangyBackendActor;
    commitMessage: string;
  }> = [];
  runResult: LangyBackendRunResult = { started: true, runId: "run-1", total: 1 };
  readonly runs: Array<{ target: string; payload: unknown; actor: LangyBackendActor }> = [];

  async project({ payload }: { payload: unknown }) {
    return {
      version: this.version,
      projection: { name: "My experiment", requested: payload } as Record<string, unknown>,
    };
  }

  async readState(): Promise<LangyBackendStateRead> {
    return { documentId: "experiment_1", version: this.version, state: savedState() };
  }

  async saveState(args: {
    expectedVersion: number;
    actor: LangyBackendActor;
    commitMessage: string;
  }): Promise<LangyBackendSaveResult> {
    if (this.staleSaves > 0) {
      this.staleSaves -= 1;
      return { saved: false, reason: "stale" };
    }
    this.saves.push({
      expectedVersion: args.expectedVersion,
      actor: args.actor,
      commitMessage: args.commitMessage,
    });
    this.version += 1;
    return { saved: true, version: this.version };
  }

  async startRun(args: {
    target: string;
    payload: unknown;
    actor: LangyBackendActor;
  }): Promise<LangyBackendRunResult> {
    this.runs.push({ target: args.target, payload: args.payload, actor: args.actor });
    return this.runResult;
  }
}

const definition = (overrides: Partial<LangyUiActionDefinition>): LangyUiActionDefinition => ({
  payloadSchema: { safeParse: (value: unknown) => ({ success: true as const, data: value }) },
  requiredPermission: "experiments:update",
  ...overrides,
});

const CALLER = { projectId: "project-1", userId: "user-1" };

let backend: FakeBackend;

beforeEach(() => {
  backend = new FakeBackend();
});

const service = () => LangyUiActionBackendService.create({ backend });

describe("LangyUiActionBackendService", () => {
  describe("when the dispatch names no experiment", () => {
    /** @scenario A backend fallback without the experiment named is refused */
    it("refuses with langy_ui_experiment_required", async () => {
      await expect(
        service().run({
          ...CALLER,
          kind: "workbench.duplicateTarget",
          definition: definition({ backend: "transform", transform: () => ({ state: {} }) }),
          payload: { targetId: "target-1" },
        }),
      ).rejects.toMatchObject({ code: "langy_ui_experiment_required" });
    });
  });

  describe("when a transform action runs against the saved state", () => {
    /** @scenario A backend edit lands as a version attributed to Langy */
    it("saves at the version it read and returns the transform result", async () => {
      const result = (await service().run({
        ...CALLER,
        kind: "workbench.duplicateTarget",
        definition: definition({
          backend: "transform",
          transform: ({ state }) => ({ state, result: { targetId: "target-2" } }),
        }),
        payload: { targetId: "target-1" },
        experimentSlug: "my-exp",
      })) as { targetId: string; version: number };

      expect(result).toEqual({ targetId: "target-2", version: 5 });
      expect(backend.saves).toEqual([
        {
          expectedVersion: 4,
          actor: { userId: "user-1", label: "langy" },
          commitMessage: "Applied workbench.duplicateTarget",
        },
      ]);
    });

    it("retries once when a concurrent writer made the read stale", async () => {
      backend.staleSaves = 1;

      const result = (await service().run({
        ...CALLER,
        kind: "workbench.duplicateTarget",
        definition: definition({
          backend: "transform",
          transform: ({ state }) => ({ state }),
        }),
        payload: {},
        experimentSlug: "my-exp",
      })) as { version: number };

      expect(result.version).toBe(5);
      expect(backend.saves).toHaveLength(1);
    });

    it("maps a transform refusal to langy_ui_handler_failed with the code", async () => {
      await expect(
        service().run({
          ...CALLER,
          kind: "workbench.duplicateTarget",
          definition: definition({
            backend: "transform",
            transform: () => {
              throw new TransformError("target_not_found");
            },
          }),
          payload: { targetId: "no-such-target" },
          experimentSlug: "my-exp",
        }),
      ).rejects.toMatchObject({
        code: "langy_ui_handler_failed",
        // The agent named a target the saved state does not have, so the
        // refusal is the caller's to fix, not an incident.
        fault: "customer",
        meta: expect.objectContaining({ errorCode: "target_not_found" }),
      });
      expect(backend.saves).toHaveLength(0);
    });
  });

  describe("when the read action falls back to the saved state", () => {
    /** @scenario get-state falls back to the saved state when no browser is attached */
    it("marks the projection as coming from the saved document", async () => {
      const result = (await service().run({
        ...CALLER,
        kind: "workbench.getState",
        definition: definition({ backend: "read", requiredPermission: "experiments:view" }),
        payload: {},
        experimentSlug: "my-exp",
      })) as { source: string; version: number; name: string };

      expect(result.source).toBe("saved");
      expect(result.version).toBe(4);
      expect(result.name).toBe("My experiment");
    });
  });

  describe("when the run action falls back to the saved state", () => {
    it("returns the run it started, attributed to Langy", async () => {
      const result = await service().run({
        ...CALLER,
        kind: "workbench.run",
        definition: definition({ backend: "run", requiredPermission: "evaluations:create" }),
        payload: { rowIndices: [0] },
        experimentSlug: "my-exp",
      });

      expect(result).toEqual({ runId: "run-1", status: "running", total: 1 });
      expect(backend.runs).toEqual([
        {
          target: "my-exp",
          payload: { rowIndices: [0] },
          actor: { userId: "user-1", label: "langy" },
        },
      ]);
    });

    it("reports the saved document's own refusal as the handler's failure", async () => {
      backend.runResult = { started: false, refusal: "no_dataset" };

      await expect(
        service().run({
          ...CALLER,
          kind: "workbench.run",
          definition: definition({ backend: "run", requiredPermission: "evaluations:create" }),
          payload: {},
          experimentSlug: "my-exp",
        }),
      ).rejects.toMatchObject({
        code: "langy_ui_handler_failed",
        meta: expect.objectContaining({ errorCode: "no_dataset" }),
      });
    });
  });
});
