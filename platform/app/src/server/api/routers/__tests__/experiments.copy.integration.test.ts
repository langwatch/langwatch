/**
 * @vitest-environment node
 *
 * Integration tests for replicating an EVALUATIONS_V3 experiment.
 *
 * Covers specs/experiments-v3/experiment-replicate.feature.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { useEvaluationsV3Store } from "~/experiments-v3/hooks/useEvaluationsV3Store";
import { extractPersistedState } from "~/experiments-v3/types/persistence";
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
  const seededIds: string[] = [];

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
            { id: { in: seededIds } },
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

  /**
   * Opens the experiment the way the editor does (server row identity first,
   * then the persisted state), edits it, and saves what autosave would send.
   */
  const openInEditorAndSave = async ({
    projectId,
    slug,
    edit,
  }: {
    projectId: string;
    slug: string;
    edit: string;
  }) => {
    const row = await caller.experiments.getEvaluationsV3BySlug({
      projectId,
      experimentSlug: slug,
    });
    const store = useEvaluationsV3Store.getState();
    store.reset();
    store.setExperimentId(row.id);
    store.setExperimentSlug(row.slug);
    store.setWorkbenchVersion(row.version);
    store.loadState(row.workbenchState);
    useEvaluationsV3Store.getState().setName(edit);

    const current = useEvaluationsV3Store.getState();
    return caller.experiments.saveEvaluationsV3({
      projectId,
      experimentId: current.experimentId,
      state: extractPersistedState(current),
    });
  };

  const findRow = (id: string, projectId = PROJECT_ID) =>
    prisma.experiment.findFirstOrThrow({ where: { id, projectId } });

  const workbenchName = (row: { workbenchState: unknown }) =>
    (row.workbenchState as Record<string, unknown>).name;

  describe("given an experiment whose saved state holds its own id, slug and results", () => {
    describe("when the experiment is replicated", () => {
      /** @scenario "A replicated experiment does not carry the original's identity" */
      it("drops the original's id and slug", async () => {
        const copy = await replicate(PROJECT_ID);
        const state = (await findRow(copy.id)).workbenchState as Record<
          string,
          unknown
        >;

        expect(state.experimentId).toBeUndefined();
        expect(state.experimentSlug).toBeUndefined();
      });

      /** @scenario "A replicated experiment does not carry the original's identity" */
      it("drops results", async () => {
        const copy = await replicate(PROJECT_ID);
        const state = (await findRow(copy.id)).workbenchState as Record<
          string,
          unknown
        >;

        expect(state.results).toBeUndefined();
      });

      /** @scenario "A replicated experiment does not carry the original's identity" */
      it("names the copy", async () => {
        const copy = await replicate(PROJECT_ID);
        const row = await findRow(copy.id);

        expect(row.name).toBe(`${originalName} (copy)`);
        expect(workbenchName(row)).toBe(`${originalName} (copy)`);
      });
    });

    describe("when the copy is opened in the editor and saved with edits", () => {
      /** @scenario "Saving a replicated experiment leaves the original untouched" */
      it("changes the copy and not the original", async () => {
        const copy = await replicate(PROJECT_ID);
        const before = await findRow(originalId);

        await openInEditorAndSave({
          projectId: PROJECT_ID,
          slug: copy.slug,
          edit: "Edited copy",
        });

        const after = await findRow(originalId);
        expect(after.workbenchState).toEqual(before.workbenchState);
        expect(after.updatedAt).toEqual(before.updatedAt);
        expect(workbenchName(await findRow(copy.id))).toBe("Edited copy");
      });
    });
  });

  describe("given a copy made before the fix whose saved state holds the original's id and slug", () => {
    describe("when the copy is opened in the editor and saved with edits", () => {
      /** @scenario "Opening a copy made before the fix edits the copy" */
      it("changes the copy and not the original", async () => {
        const oldCopyId = `experiment_${nanoid(8)}`;
        const oldCopySlug = `old-copy-${nanoid(6)}`;
        seededIds.push(oldCopyId);
        await prisma.experiment.create({
          data: {
            id: oldCopyId,
            name: `${originalName} (old copy)`,
            slug: oldCopySlug,
            projectId: PROJECT_ID,
            type: ExperimentType.EVALUATIONS_V3,
            workbenchState: { ...originalState, results: undefined },
          },
        });
        const before = await findRow(originalId);

        await openInEditorAndSave({
          projectId: PROJECT_ID,
          slug: oldCopySlug,
          edit: "Edited old copy",
        });

        const after = await findRow(originalId);
        expect(after.workbenchState).toEqual(before.workbenchState);
        expect(after.updatedAt).toEqual(before.updatedAt);
        expect(workbenchName(await findRow(oldCopyId))).toBe("Edited old copy");
      });
    });
  });

  describe("given an experiment replicated into another project", () => {
    describe("when the copy is opened in the editor and saved in that project", () => {
      /** @scenario "A replicated experiment in another project can be saved" */
      it("persists the edit in that project", async () => {
        const copy = await replicate(otherProjectId);

        await openInEditorAndSave({
          projectId: otherProjectId,
          slug: copy.slug,
          edit: "Edited cross-project copy",
        });

        const saved = await findRow(copy.id, otherProjectId);
        expect(saved.projectId).toBe(otherProjectId);
        expect(workbenchName(saved)).toBe("Edited cross-project copy");
      });
    });
  });
});
