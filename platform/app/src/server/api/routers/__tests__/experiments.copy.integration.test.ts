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
import { WorkbenchMissingReferenceError } from "../../../experiments/errors";
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
  const seededDatasetIds: string[] = [];
  const seededPromptIds: string[] = [];

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
    // Delete experiments from main project
    await prisma.experiment.deleteMany({
      where: {
        projectId: PROJECT_ID,
        id: { in: [originalId, ...seededIds] },
      },
    });
    // Delete experiments from created projects
    for (const pid of createdProjectIds) {
      await prisma.experiment.deleteMany({ where: { projectId: pid } });
    }
    // Delete prompts from main project
    await prisma.llmPromptConfig.deleteMany({
      where: {
        projectId: PROJECT_ID,
        id: { in: seededPromptIds },
      },
    });
    // Delete datasets from main project
    await prisma.dataset.deleteMany({
      where: {
        projectId: PROJECT_ID,
        id: { in: seededDatasetIds },
      },
    });
    // Delete datasets from created projects
    for (const pid of createdProjectIds) {
      await prisma.dataset.deleteMany({ where: { projectId: pid } });
    }
    // Delete created projects
    for (const pid of createdProjectIds) {
      await prisma.project.delete({ where: { id: pid } });
    }
  });

  const replicate = async (
    projectId: string,
    {
      experimentId = originalId,
      copyDatasets = false,
    }: { experimentId?: string; copyDatasets?: boolean } = {},
  ) => {
    const { experiment } = await caller.experiments.copy({
      experimentId,
      projectId,
      sourceProjectId: PROJECT_ID,
      copyDatasets,
    });
    seededIds.push(experiment.id);
    return experiment;
  };

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

  /** A source experiment in PROJECT_ID whose state is `stateOverrides` over a bare state. */
  const seedSourceExperiment = async (
    stateOverrides: Record<string, unknown>,
  ) => {
    const id = `experiment_${nanoid(8)}`;
    seededIds.push(id);
    await prisma.experiment.create({
      data: {
        id,
        name: `Source ${id}`,
        slug: `src-${nanoid(6)}`,
        projectId: PROJECT_ID,
        type: ExperimentType.EVALUATIONS_V3,
        workbenchState: {
          name: `Source ${id}`,
          datasets: [],
          activeDatasetId: "dataset-1",
          evaluators: [],
          targets: [],
          ...stateOverrides,
        },
      },
    });
    return id;
  };

  const seedSavedDataset = async () => {
    const id = `dataset_${nanoid(10)}`;
    seededDatasetIds.push(id);
    await prisma.dataset.create({
      data: {
        id,
        name: `Saved ${id}`,
        slug: `saved-${nanoid(8)}`,
        projectId: PROJECT_ID,
        columnTypes: [],
      },
    });
    return id;
  };

  const seedPrompt = async () => {
    const project = await prisma.project.findFirstOrThrow({
      where: { id: PROJECT_ID },
      select: { team: { select: { organizationId: true } } },
    });
    if (!project.team?.organizationId) {
      throw new Error("test fixture: project has no organizationId");
    }
    const id = `prompt_${nanoid(10)}`;
    seededPromptIds.push(id);
    await prisma.llmPromptConfig.create({
      data: {
        id,
        name: `Prompt ${id}`,
        projectId: PROJECT_ID,
        organizationId: project.team.organizationId,
      },
    });
    return id;
  };

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

  describe("given an experiment with a saved dataset replicated into another project with its datasets copied", () => {
    describe("when the copy is opened in the editor and saved in that project", () => {
      /** @scenario "A copy into another project with its dataset copied can be saved" */
      it("saves against the copied dataset and leaves the original unchanged", async () => {
        const sourceDatasetId = await seedSavedDataset();
        const sourceId = await seedSourceExperiment({
          datasets: [
            {
              id: "saved-ds-1",
              name: "Saved dataset",
              type: "saved",
              datasetId: sourceDatasetId,
              columns: [],
            },
          ],
          activeDatasetId: "saved-ds-1",
        });
        const before = await findRow(sourceId);

        const copy = await replicate(otherProjectId, {
          experimentId: sourceId,
          copyDatasets: true,
        });
        await openInEditorAndSave({
          projectId: otherProjectId,
          slug: copy.slug,
          edit: "Edited copy with copied dataset",
        });

        const saved = await findRow(copy.id, otherProjectId);
        const savedDataset = (
          saved.workbenchState as {
            datasets: Array<{ datasetId?: string }>;
          }
        ).datasets[0];
        expect(savedDataset?.datasetId).not.toBe(sourceDatasetId);
        const copiedDataset = await prisma.dataset.findFirstOrThrow({
          where: { id: savedDataset?.datasetId, projectId: otherProjectId },
        });
        expect(copiedDataset.projectId).toBe(otherProjectId);

        const after = await findRow(sourceId);
        expect(after.workbenchState).toEqual(before.workbenchState);
        expect(after.updatedAt).toEqual(before.updatedAt);
      });
    });
  });

  describe("given an experiment whose target uses a prompt, replicated into another project", () => {
    describe("when the copy is opened in the editor and saved in that project", () => {
      /** @scenario "Saving a copy in another project that still uses a source-project prompt is refused" */
      it("refuses the save and leaves the original unchanged", async () => {
        const promptId = await seedPrompt();
        const sourceId = await seedSourceExperiment({
          targets: [{ id: "target-1", type: "prompt", promptId, mappings: {} }],
        });
        const before = await findRow(sourceId);

        const copy = await replicate(otherProjectId, {
          experimentId: sourceId,
        });
        const error = await openInEditorAndSave({
          projectId: otherProjectId,
          slug: copy.slug,
          edit: "Edited copy with source prompt",
        }).then(
          () => undefined,
          (e: unknown) => e,
        );

        // handledErrorMiddleware re-raises the domain error as a TRPCError
        // whose cause is the HandledError itself.
        expect(error).toBeDefined();
        expect((error as { cause?: unknown }).cause).toBeInstanceOf(
          WorkbenchMissingReferenceError,
        );
        expect((error as { cause: { code: string } }).cause.code).toBe(
          "experiment_workbench_missing_reference",
        );
        expect(
          (
            error as {
              cause: {
                meta: Record<string, unknown>;
              };
            }
          ).cause.meta,
        ).toEqual({ refType: "prompt", refId: promptId });

        const after = await findRow(sourceId);
        expect(after.workbenchState).toEqual(before.workbenchState);
        expect(after.updatedAt).toEqual(before.updatedAt);
      });
    });
  });
});
