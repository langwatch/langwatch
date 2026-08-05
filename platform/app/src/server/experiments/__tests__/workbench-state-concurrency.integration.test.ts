/**
 * Integration tests for the optimistic-concurrency guard on
 * ExperimentService.updateWorkbenchState.
 *
 * @see specs/experiments-v3/cli-comparison-target.feature
 *
 * The workbench state is one JSON field with two writers: the Workbench UI
 * autosaves the whole thing over tRPC, and the API-key routes read it, patch a
 * piece and write it back. Whichever of those lands second used to discard the
 * other in full, so the conditional write is what makes the second one fail
 * loudly instead. Proving that needs a real row, because the condition is a
 * `WHERE updatedAt = ...` the database evaluates.
 */

import type { Experiment, Prisma, Project } from "@prisma/client";
import { ExperimentType } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PersistedEvaluationsV3State } from "~/experiments-v3/types/persistence";
import { prisma } from "~/server/db";
import { getTestProject } from "~/utils/testUtils";
import { ExperimentService } from "../experiment.service";

const workbenchState = (name: string): PersistedEvaluationsV3State => ({
  name,
  datasets: [
    {
      id: "dataset-1",
      name: "Test Dataset",
      type: "inline",
      columns: [{ id: "input", name: "input", type: "string" }],
    },
  ],
  activeDatasetId: "dataset-1",
  evaluators: [],
  targets: [],
});

/** The shape Prisma writes a Json column from, same conversion the service does. */
const asJson = (state: PersistedEvaluationsV3State): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue;

describe("ExperimentService.updateWorkbenchState", () => {
  let project: Project;
  let service: ExperimentService;
  const createdIds: string[] = [];

  beforeAll(async () => {
    project = await getTestProject("experiment-workbench-concurrency");
    service = ExperimentService.create(prisma);
  });

  afterEach(async () => {
    if (createdIds.length === 0) return;
    await prisma.experiment.deleteMany({
      where: { id: { in: createdIds }, projectId: project.id },
    });
    createdIds.length = 0;
  });

  const createExperiment = async (): Promise<Experiment> => {
    const id = `exp_${nanoid()}`;
    createdIds.push(id);
    return prisma.experiment.create({
      data: {
        id,
        projectId: project.id,
        name: "Concurrency Test",
        slug: `workbench-concurrency-${nanoid(6)}`,
        type: ExperimentType.EVALUATIONS_V3,
        workbenchState: asJson(workbenchState("original")),
      },
    });
  };

  describe("given nobody else wrote in between", () => {
    it("persists the new state", async () => {
      const experiment = await createExperiment();

      await service.updateWorkbenchState({
        projectId: project.id,
        id: experiment.id,
        workbenchState: workbenchState("attached"),
        expectedUpdatedAt: experiment.updatedAt,
      });

      const stored = await prisma.experiment.findFirstOrThrow({
        where: { id: experiment.id, projectId: project.id },
      });
      expect((stored.workbenchState as { name: string }).name).toBe("attached");
    });
  });

  describe("when another writer saved the experiment after it was read", () => {
    /** @scenario "A concurrent save refuses the write instead of discarding it" */
    it("refuses the write and leaves the other writer's state intact", async () => {
      const experiment = await createExperiment();

      // The Workbench autosave: same row, same field, landing first.
      //
      // `updatedAt` is pinned rather than left to Prisma so the test turns on
      // the version having MOVED, not on whether two back-to-back writes happen
      // to fall either side of a millisecond boundary. `updatedAt` is a
      // timestamp(3), so a test that writes twice inside the same millisecond
      // leaves the version unchanged and passes or fails on machine speed.
      await prisma.experiment.update({
        where: { id: experiment.id, projectId: project.id },
        data: {
          workbenchState: asJson(workbenchState("saved-by-the-workbench")),
          updatedAt: new Date(experiment.updatedAt.getTime() + 1000),
        },
      });

      const conflict: unknown = await service
        .updateWorkbenchState({
          projectId: project.id,
          id: experiment.id,
          workbenchState: workbenchState("attached"),
          expectedUpdatedAt: experiment.updatedAt,
        })
        .then(
          () => undefined,
          (error: unknown) => error,
        );

      expect((conflict as { code?: string } | undefined)?.code).toBe(
        "experiment_update_conflict",
      );

      const stored = await prisma.experiment.findFirstOrThrow({
        where: { id: experiment.id, projectId: project.id },
      });
      expect((stored.workbenchState as { name: string }).name).toBe(
        "saved-by-the-workbench",
      );
    });
  });

  describe("when the payload does not match the persisted schema", () => {
    it("refuses to write it", async () => {
      const experiment = await createExperiment();

      await expect(
        service.updateWorkbenchState({
          projectId: project.id,
          id: experiment.id,
          workbenchState: {
            ...workbenchState("attached"),
            targets: [{ id: "target-a" }],
          } as unknown as PersistedEvaluationsV3State,
          expectedUpdatedAt: experiment.updatedAt,
        }),
      ).rejects.toThrow();

      const stored = await prisma.experiment.findFirstOrThrow({
        where: { id: experiment.id, projectId: project.id },
      });
      expect((stored.workbenchState as { name: string }).name).toBe("original");
    });
  });
});
