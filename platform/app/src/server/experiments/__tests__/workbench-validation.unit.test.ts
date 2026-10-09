/**
 * Unit tests for the workbench write seam's validation half: the schema check,
 * the reference checks, and what a version snapshot keeps.
 *
 * @see specs/experiments-v3/workbench-versioning.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";
import type { PersistedEvaluationsV3State } from "~/experiments-v3/types/persistence";
import type { Prisma } from "~/generated/prisma/client";
import type { ExperimentRepository } from "../experiment.repository";
import { ExperimentService } from "../experiment.service";
import type {
  WorkbenchReferenceRepository,
  WorkbenchReferenceType,
} from "../workbenchReference.repository";
import { stripResults } from "../workbenchValidation";

const baseState = (
  overrides: Partial<PersistedEvaluationsV3State> = {},
): PersistedEvaluationsV3State =>
  ({
    name: "My evaluation",
    datasets: [
      {
        id: "dataset-1",
        name: "Inline",
        type: "inline",
        columns: [{ id: "input", name: "input", type: "string" }],
      },
    ],
    activeDatasetId: "dataset-1",
    evaluators: [],
    targets: [],
    ...overrides,
  }) as PersistedEvaluationsV3State;

const target = (overrides: Record<string, unknown>) => ({
  id: `target-${String(overrides.type)}`,
  type: overrides.type,
  mappings: {},
  ...overrides,
});

interface Recorded {
  liveState: unknown;
  versionState: unknown;
  /**
   * Whether the write ever opened its transaction. The seam promises that
   * parsing and the reference checks happen BEFORE it opens, so a refused
   * write must leave this false and the version counter where it was.
   */
  hasEnteredTransaction: boolean;
}

const makeService = ({
  existingIds = [],
  rowType = "EVALUATIONS_V3",
}: {
  existingIds?: string[];
  rowType?: string;
} = {}): {
  service: ExperimentService;
  recorded: Recorded;
} => {
  const recorded: Recorded = {
    liveState: null,
    versionState: null,
    hasEnteredTransaction: false,
  };

  const references = {
    findExistingIds: async ({
      ids,
    }: {
      refType: WorkbenchReferenceType;
      ids: readonly string[];
      projectId: string;
    }) => new Set(ids.filter((id) => existingIds.includes(id))),
  } as unknown as WorkbenchReferenceRepository;

  const repository = {
    getRowStatusById: async () => ({
      exists: true,
      archived: false,
      slug: "my-evaluation",
    }),
    runInTransaction: async <T>(
      fn: (tx: Prisma.TransactionClient) => Promise<T>,
    ) => {
      recorded.hasEnteredTransaction = true;
      return await fn({} as Prisma.TransactionClient);
    },
    findWorkbenchRow: async () => ({
      id: "experiment_1",
      slug: "my-evaluation",
      name: "My evaluation",
      type: rowType,
      workbenchState: null,
      workbenchVersion: 3,
      updatedAt: new Date(),
    }),
    casUpdateWorkbenchState: async (input: {
      workbenchState: Prisma.InputJsonValue;
    }) => {
      recorded.liveState = input.workbenchState;
      return {};
    },
    findRollingAutosaveVersion: async () => null,
    createVersion: async (input: {
      data: Prisma.ExperimentVersionUncheckedCreateInput;
    }) => {
      recorded.versionState = input.data.state;
    },
    updateVersionById: async () => undefined,
  } as unknown as ExperimentRepository;

  return {
    service: new ExperimentService(repository, references),
    recorded,
  };
};

const save = async ({
  service,
  state,
}: {
  service: ExperimentService;
  state: unknown;
}): Promise<void> => {
  await service.saveWorkbenchState({
    projectId: "project_1",
    id: "experiment_1",
    state,
    actor: { label: "user" },
  });
};

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    return HandledError.isHandled(error) ? error.code : "not_handled";
  }
  return "no_error";
};

describe("workbench state validation", () => {
  describe("given a state that does not match the schema", () => {
    describe("when it is saved", () => {
      /** @scenario A state that does not match the schema is refused */
      it("refuses the write with the invalid-state code", async () => {
        const { service } = makeService();
        const invalid = { ...baseState(), activeDatasetId: 42 };

        expect(await codeOf(save({ service, state: invalid }))).toBe(
          "experiment_invalid_workbench_state",
        );
      });

      it("names the offending field so the caller can correct it", async () => {
        const { service } = makeService();
        const invalid = { ...baseState(), activeDatasetId: 42 };

        try {
          await save({ service, state: invalid });
          expect.unreachable("the save should have been refused");
        } catch (error) {
          const meta = HandledError.isHandled(error) ? error.meta : {};
          expect(JSON.stringify(meta)).toContain("activeDatasetId");
        }
      });

      it("refuses before it opens the transaction", async () => {
        const { service, recorded } = makeService();
        const invalid = { ...baseState(), activeDatasetId: 42 };

        await codeOf(save({ service, state: invalid }));

        expect(recorded.hasEnteredTransaction).toBe(false);
      });
    });
  });

  describe("given a state pointing at a row this project does not have", () => {
    const cases: Array<{
      refType: WorkbenchReferenceType;
      refId: string;
      state: PersistedEvaluationsV3State;
    }> = [
      {
        refType: "prompt",
        refId: "prompt_gone",
        state: baseState({
          targets: [target({ type: "prompt", promptId: "prompt_gone" })] as any,
        }),
      },
      {
        refType: "agent",
        refId: "agent_gone",
        state: baseState({
          targets: [target({ type: "agent", dbAgentId: "agent_gone" })] as any,
        }),
      },
      {
        refType: "evaluator",
        refId: "evaluator_gone",
        state: baseState({
          targets: [
            target({ type: "evaluator", targetEvaluatorId: "evaluator_gone" }),
          ] as any,
        }),
      },
      {
        refType: "workflow",
        refId: "workflow_gone",
        state: baseState({
          targets: [
            target({ type: "workflow", workflowId: "workflow_gone" }),
          ] as any,
        }),
      },
      {
        refType: "dataset",
        refId: "dataset_gone",
        state: baseState({
          datasets: [
            {
              id: "dataset-1",
              name: "Saved",
              type: "saved",
              datasetId: "dataset_gone",
              columns: [],
            },
          ] as any,
        }),
      },
    ];

    for (const { refType, refId, state } of cases) {
      describe(`when the missing row is a ${refType}`, () => {
        /** @scenario A state pointing at a row that no longer exists is refused */
        it("refuses the write and names the kind and the id", async () => {
          const { service } = makeService();

          try {
            await save({ service, state });
            expect.unreachable("the save should have been refused");
          } catch (error) {
            expect(HandledError.isHandled(error)).toBe(true);
            if (!HandledError.isHandled(error)) return;
            expect(error.code).toBe("experiment_workbench_missing_reference");
            expect(error.meta).toEqual({ refType, refId });
          }
        });

        it("refuses before it opens the transaction", async () => {
          const { service, recorded } = makeService();

          await codeOf(save({ service, state }));

          expect(recorded.hasEnteredTransaction).toBe(false);
        });
      });
    }
  });

  describe("given a target switched to another type that kept its old id", () => {
    describe("when it is saved", () => {
      /** @scenario A reference the run would not read is not checked */
      it("accepts the write, because the run reads the id of its own type", async () => {
        const { service } = makeService({ existingIds: ["agent_1"] });
        const state = baseState({
          targets: [
            target({
              type: "agent",
              dbAgentId: "agent_1",
              promptId: "prompt_deleted",
            }),
          ] as any,
        });

        expect(await codeOf(save({ service, state }))).toBe("no_error");
      });
    });
  });

  describe("given a target whose own type names a row that is gone", () => {
    describe("when it is saved", () => {
      /** @scenario A reference the run would read is still checked */
      it("refuses the write and names that reference", async () => {
        const { service } = makeService({ existingIds: ["prompt_1"] });
        const state = baseState({
          targets: [
            target({
              type: "agent",
              dbAgentId: "agent_deleted",
              promptId: "prompt_1",
            }),
          ] as any,
        });

        try {
          await save({ service, state });
          expect.unreachable("the save should have been refused");
        } catch (error) {
          expect(HandledError.isHandled(error)).toBe(true);
          if (!HandledError.isHandled(error)) return;
          expect(error.code).toBe("experiment_workbench_missing_reference");
          expect(error.meta).toEqual({
            refType: "agent",
            refId: "agent_deleted",
          });
        }
      });
    });
  });

  describe("given a state whose evaluator config names a database evaluator", () => {
    describe("when the evaluator exists", () => {
      it("accepts the write", async () => {
        const { service } = makeService({ existingIds: ["evaluator_1"] });
        const state = baseState({
          evaluators: [
            {
              id: "evaluator-1",
              evaluatorType: "langevals/basic",
              inputs: [],
              mappings: {},
              dbEvaluatorId: "evaluator_1",
            },
          ] as any,
        });

        expect(await codeOf(save({ service, state }))).toBe("no_error");
      });
    });
  });

  describe("given a state that carries run results", () => {
    const withResults = baseState({
      results: {
        runId: "run_1",
        targetOutputs: { "target-1": ["out"] },
        targetMetadata: {},
        evaluatorResults: {},
        errors: {},
      },
    });

    describe("when it is saved", () => {
      /** @scenario Run results are not stored in the version snapshot */
      it("keeps the results on the live row and strips them from the snapshot", async () => {
        const { service, recorded } = makeService();

        await save({ service, state: withResults });

        expect(recorded.liveState).toHaveProperty("results");
        expect(recorded.versionState).not.toHaveProperty("results");
      });
    });

    describe("when only the snapshot form is taken", () => {
      it("leaves every other field in place", () => {
        const snapshot = stripResults(withResults);

        expect(snapshot.results).toBeUndefined();
        expect(snapshot.name).toBe(withResults.name);
        expect(snapshot.datasets).toEqual(withResults.datasets);
      });
    });
  });

  describe("given an experiment that is not an evaluations workbench", () => {
    describe("when its workbench state is read", () => {
      /** @scenario A workbench call on another kind of experiment is refused with a code */
      it("refuses with the type-mismatch code and a 400", async () => {
        const { service } = makeService({ rowType: "BATCH_EVALUATION" });

        try {
          await service.getWorkbenchState({
            projectId: "project_1",
            id: "experiment_1",
          });
          expect.unreachable("the read should have been refused");
        } catch (error) {
          expect(HandledError.isHandled(error)).toBe(true);
          if (!HandledError.isHandled(error)) return;
          expect(error.code).toBe("experiment_type_mismatch");
          expect(error.httpStatus).toBe(400);
        }
      });
    });

    describe("when a workbench save targets it", () => {
      it("refuses with the same code", async () => {
        const { service } = makeService({ rowType: "BATCH_EVALUATION" });

        expect(await codeOf(save({ service, state: baseState() }))).toBe(
          "experiment_type_mismatch",
        );
      });
    });
  });
});
