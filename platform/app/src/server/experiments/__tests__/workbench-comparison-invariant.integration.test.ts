/**
 * Integration tests for the comparison-column invariant at the write seam,
 * against real Postgres.
 *
 * A `comparison` config turns an evaluator from a score attached to every
 * target column into a column of its own that judges the other columns. Only
 * the comparison judge can do that. These prove the two halves that have to
 * hold together: a save carrying the broken shape is refused, and a row that
 * already holds it is still editable, because it is repaired on read.
 *
 * @see specs/experiments-v3/workbench-actions.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PersistedEvaluationsV3State } from "~/experiments-v3/types/persistence";
import type { Project } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { getTestProject } from "~/utils/testUtils";
import { ExperimentService } from "../experiment.service";

const COMPARISON_CONFIG = {
  variants: ["target-1", "target-2"],
  goldenField: "l3",
  hasGoldenAnswer: true,
  variantOutputPaths: { "target-1": ["output"] },
  includeMetrics: [],
  randomizeOrder: true,
};

/** The per-target mappings a plain attached evaluator needs, and already had. */
const EVALUATOR_MAPPINGS = {
  "dataset-1": {
    "target-1": {
      output: {
        type: "source",
        source: "target",
        sourceId: "target-1",
        sourceField: "output",
      },
      expected_output: {
        type: "source",
        source: "dataset",
        sourceId: "dataset-1",
        sourceField: "l3",
      },
    },
  },
};

const stateWith = (
  evaluators: unknown[],
  name = "Comparison invariant",
): PersistedEvaluationsV3State =>
  ({
    name,
    datasets: [
      {
        id: "dataset-1",
        name: "Inline",
        type: "inline",
        columns: [{ id: "l3", name: "l3", type: "string" }],
      },
    ],
    activeDatasetId: "dataset-1",
    evaluators,
    targets: [],
  }) as unknown as PersistedEvaluationsV3State;

/** The shape a saved evaluation really held before the invariant existed. */
const brokenEvaluator = {
  id: "evaluator_q5RPFdOD",
  evaluatorType: "langevals/exact_match",
  inputs: [],
  comparison: COMPARISON_CONFIG,
  mappings: EVALUATOR_MAPPINGS,
  localEvaluatorConfig: { name: "L3 category exact match" },
};

const comparisonJudge = {
  id: "evaluator_compare",
  evaluatorType: "langevals/select_best_compare",
  inputs: [],
  comparison: COMPARISON_CONFIG,
  mappings: {},
};

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    return HandledError.isHandled(error) ? error.code : "not_handled";
  }
  return "no_error";
};

describe("workbench comparison invariant", () => {
  let project: Project;
  let service: ExperimentService;
  const createdIds: string[] = [];

  beforeAll(async () => {
    project = await getTestProject("workbench-comparison-invariant");
    service = ExperimentService.create({ prisma });
  });

  afterAll(async () => {
    await prisma.experimentVersion.deleteMany({
      where: { experimentId: { in: createdIds }, projectId: project.id },
    });
    await prisma.experiment.deleteMany({
      where: { id: { in: createdIds }, projectId: project.id },
    });
  });

  const createEvaluation = async (
    evaluators: unknown[] = [],
  ): Promise<{ experimentId: string; version: number }> => {
    const created = await service.createEvaluationsV3({
      projectId: project.id,
      state: stateWith(evaluators, `Comparison ${nanoid(6)}`),
      actor: { label: "user" },
    });
    createdIds.push(created.experimentId);
    return { experimentId: created.experimentId, version: created.version };
  };

  const storedEvaluators = async (
    experimentId: string,
  ): Promise<Record<string, unknown>[]> => {
    const row = await prisma.experiment.findFirstOrThrow({
      where: { id: experimentId, projectId: project.id },
    });
    return (row.workbenchState as unknown as PersistedEvaluationsV3State)
      .evaluators as unknown as Record<string, unknown>[];
  };

  describe("given a state whose plain evaluator carries a comparison config", () => {
    describe("when it is saved", () => {
      /** @scenario "Only the comparison judge can be a standalone comparison column" */
      it("refuses the write with the invalid-state code", async () => {
        const { experimentId, version } = await createEvaluation();

        expect(
          await codeOf(
            service.saveWorkbenchState({
              projectId: project.id,
              id: experimentId,
              state: stateWith([brokenEvaluator]),
              expectedVersion: version,
              actor: { label: "langy" },
            }),
          ),
        ).toBe("experiment_invalid_workbench_state");
      });

      it("names the evaluator and its type so the caller can correct it", async () => {
        const { experimentId, version } = await createEvaluation();

        try {
          await service.saveWorkbenchState({
            projectId: project.id,
            id: experimentId,
            state: stateWith([brokenEvaluator]),
            expectedVersion: version,
            actor: { label: "langy" },
          });
          expect.unreachable("the save should have been refused");
        } catch (error) {
          const meta = HandledError.isHandled(error) ? error.meta : {};
          expect(JSON.stringify(meta)).toContain("evaluator_q5RPFdOD");
          expect(JSON.stringify(meta)).toContain("langevals/exact_match");
        }
      });

      it("leaves the stored state exactly as it was", async () => {
        const { experimentId, version } = await createEvaluation();
        const before = await prisma.experiment.findFirstOrThrow({
          where: { id: experimentId, projectId: project.id },
        });

        await codeOf(
          service.saveWorkbenchState({
            projectId: project.id,
            id: experimentId,
            state: stateWith([brokenEvaluator]),
            expectedVersion: version,
            actor: { label: "langy" },
          }),
        );

        const after = await prisma.experiment.findFirstOrThrow({
          where: { id: experimentId, projectId: project.id },
        });
        expect(after.workbenchVersion).toBe(before.workbenchVersion);
        expect(after.workbenchState).toEqual(before.workbenchState);
      });
    });

    describe("when the comparison judge carries the same config", () => {
      it("accepts the standalone comparison column", async () => {
        const { experimentId, version } = await createEvaluation();

        await service.saveWorkbenchState({
          projectId: project.id,
          id: experimentId,
          state: stateWith([comparisonJudge]),
          expectedVersion: version,
          actor: { label: "user" },
        });

        const [saved] = await storedEvaluators(experimentId);
        expect(saved?.comparison).toBeDefined();
      });
    });
  });

  /**
   * A row written before the invariant existed. It has to stay editable: if the
   * save seam refused it and nothing repaired it, every later edit of that
   * evaluation would fail on a field the customer never typed.
   */
  describe("given a saved evaluation that already holds the broken shape", () => {
    const seedBrokenRow = async (): Promise<string> => {
      const { experimentId } = await createEvaluation();
      await prisma.experiment.update({
        where: { id: experimentId, projectId: project.id },
        data: {
          workbenchState: JSON.parse(
            JSON.stringify(stateWith([brokenEvaluator])),
          ),
        },
      });
      return experimentId;
    };

    describe("when it is read back", () => {
      /** @scenario "A stored comparison config on a plain evaluator is repaired" */
      it("reads as an evaluator attached to every target column", async () => {
        const experimentId = await seedBrokenRow();

        const current = await service.getWorkbenchState({
          projectId: project.id,
          id: experimentId,
        });

        expect(current.state?.evaluators[0]?.comparison).toBeUndefined();
      });

      it("keeps the per-target mappings the attached evaluator needs", async () => {
        const experimentId = await seedBrokenRow();

        const current = await service.getWorkbenchState({
          projectId: project.id,
          id: experimentId,
        });

        expect(current.state?.evaluators[0]?.mappings).toEqual(
          EVALUATOR_MAPPINGS,
        );
      });
    });

    describe("when the assistant edits it", () => {
      /** @scenario "A stored comparison config on a plain evaluator is repaired" */
      it("saves the edit instead of refusing it", async () => {
        const experimentId = await seedBrokenRow();

        const { version } = await service.applyWorkbenchTransform({
          projectId: project.id,
          id: experimentId,
          actor: { label: "langy" },
          transform: (state) => ({ ...state, name: "Renamed by the agent" }),
        });

        expect(version).toBeGreaterThan(0);
      });

      /** @scenario "A stored comparison config on a plain evaluator is repaired" */
      it("writes the repaired evaluator back to the row", async () => {
        const experimentId = await seedBrokenRow();

        await service.applyWorkbenchTransform({
          projectId: project.id,
          id: experimentId,
          actor: { label: "langy" },
          transform: (state) => ({ ...state, name: "Renamed by the agent" }),
        });

        const [saved] = await storedEvaluators(experimentId);
        expect(saved?.comparison).toBeUndefined();
        expect(saved?.id).toBe("evaluator_q5RPFdOD");
        expect(saved?.mappings).toEqual(EVALUATOR_MAPPINGS);
      });
    });
  });
});
