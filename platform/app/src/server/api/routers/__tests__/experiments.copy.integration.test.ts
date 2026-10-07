/**
 * @vitest-environment node
 *
 * Integration tests for replicating an EVALUATIONS_V3 experiment.
 *
 * Covers specs/experiments-v3/experiment-replicate.feature.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ExperimentType } from "~/generated/prisma/client";
import { getTestUser } from "../../../../utils/testUtils";
import { globalForApp } from "../../../app-layer/app";
import { createTestApp } from "../../../app-layer/presets";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

vi.mock("../../../license-enforcement", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../license-enforcement")>();
  return {
    ...actual,
    enforceLicenseLimit: vi.fn(),
  };
});

const PROJECT_ID = "test-project-id";

describe("experiments.copy", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;
  let previousApp: typeof globalForApp.__langwatch_app;
  let otherProjectId: string;
  const createdProjectIds: string[] = [];

  const originalId = `experiment_${nanoid(8)}`;
  const originalSlug = `orig-${nanoid(6)}`;
  const originalName = `Original ${nanoid(6)}`;
  const originalState = {
    experimentId: originalId,
    experimentSlug: originalSlug,
    name: originalName,
    datasets: [],
    activeDatasetId: "dataset-1",
    evaluators: [],
    targets: [],
    results: { runId: "run-1" },
  };

  beforeAll(async () => {
    previousApp = globalForApp.__langwatch_app;
    globalForApp.__langwatch_app = createTestApp();
    const user = await getTestUser();
    caller = appRouter.createCaller(
      createInnerTRPCContext({
        session: { user: { id: user.id }, expires: "1" },
      }),
    );

    otherProjectId = `${PROJECT_ID}-copy-${nanoid(6)}`;
    const sourceProject = await prisma.project.findFirstOrThrow({
      where: { id: PROJECT_ID },
      select: { teamId: true },
    });
    await prisma.project.create({
      data: {
        id: otherProjectId,
        name: `Other ${otherProjectId}`,
        slug: otherProjectId,
        teamId: sourceProject.teamId,
        language: "python",
        framework: "openai",
        apiKey: `qa-key-${otherProjectId}`,
      },
    });
    createdProjectIds.push(otherProjectId);

    await prisma.experiment.create({
      data: {
        id: originalId,
        name: originalName,
        slug: originalSlug,
        projectId: PROJECT_ID,
        type: ExperimentType.EVALUATIONS_V3,
        workbenchState: originalState,
      },
    });
  });

  afterAll(async () => {
    globalForApp.__langwatch_app = previousApp;
    await prisma.experiment
      .deleteMany({
        where: {
          OR: [
            { id: originalId },
            { projectId: PROJECT_ID, name: `${originalName} (copy)` },
          ],
        },
      })
      .catch(() => {});
    for (const pid of createdProjectIds) {
      await prisma.experiment
        .deleteMany({ where: { projectId: pid } })
        .catch(() => {});
      await prisma.project.delete({ where: { id: pid } }).catch(() => {});
    }
  });

  const replicate = async (projectId: string) =>
    (
      await caller.experiments.copy({
        experimentId: originalId,
        projectId,
        sourceProjectId: PROJECT_ID,
        copyDatasets: false,
      })
    ).experiment;

  describe("given an experiment whose saved state holds its own id, slug and results", () => {
    describe("when the experiment is replicated", () => {
      /** @scenario "A replicated experiment does not carry the original's identity" */
      it("drops id, slug and results and names the copy", async () => {
        const copy = await replicate(PROJECT_ID);
        const row = await prisma.experiment.findFirstOrThrow({
          where: { id: copy.id, projectId: PROJECT_ID },
        });
        const state = row.workbenchState as Record<string, unknown>;

        expect(state.experimentId).toBeUndefined();
        expect(state.experimentSlug).toBeUndefined();
        expect(state.results).toBeUndefined();
        expect(row.name).toBe(`${originalName} (copy)`);
        expect(state.name).toBe(`${originalName} (copy)`);
      });
    });

    describe("when the copy is saved with edits", () => {
      /** @scenario "Saving a replicated experiment leaves the original untouched" */
      it("changes the copy and not the original", async () => {
        const copy = await replicate(PROJECT_ID);
        const before = await prisma.experiment.findFirstOrThrow({
          where: { id: originalId, projectId: PROJECT_ID },
        });

        await caller.experiments.saveEvaluationsV3({
          projectId: PROJECT_ID,
          experimentId: copy.id,
          state: {
            name: "Edited copy",
            datasets: [],
            activeDatasetId: "dataset-1",
            evaluators: [],
            targets: [],
          },
        });

        const after = await prisma.experiment.findFirstOrThrow({
          where: { id: originalId, projectId: PROJECT_ID },
        });
        const savedCopy = await prisma.experiment.findFirstOrThrow({
          where: { id: copy.id, projectId: PROJECT_ID },
        });

        expect(after.workbenchState).toEqual(before.workbenchState);
        expect(after.updatedAt).toEqual(before.updatedAt);
        expect((savedCopy.workbenchState as Record<string, unknown>).name).toBe(
          "Edited copy",
        );
      });
    });
  });

  describe("given an experiment replicated into another project", () => {
    describe("when the copy is saved in that project", () => {
      /** @scenario "A replicated experiment in another project can be saved" */
      it("succeeds", async () => {
        const copy = await replicate(otherProjectId);

        await expect(
          caller.experiments.saveEvaluationsV3({
            projectId: otherProjectId,
            experimentId: copy.id,
            state: {
              name: "Edited cross-project copy",
              datasets: [],
              activeDatasetId: "dataset-1",
              evaluators: [],
              targets: [],
            },
          }),
        ).resolves.toBeDefined();
      });
    });
  });
});
