/**
 * @vitest-environment node
 *
 * Integration tests for experiment archive (formerly delete).
 *
 * Covers specs/experiments-v3/experiment-archive.feature. The Postgres
 * layer is the real test instance and the tRPC mutation runs end to end;
 * only the licence-enforcement boundary is stubbed so the test does not
 * require a licensed organisation row to be seeded.
 */
import { ExperimentType } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

async function expectTRPCError(
  promise: Promise<unknown>,
  code: TRPCError["code"],
) {
  let captured: unknown;
  try {
    await promise;
  } catch (e) {
    captured = e;
  }
  expect(captured, "expected the promise to reject").toBeInstanceOf(TRPCError);
  expect((captured as TRPCError).code).toBe(code);
}

describe("experiments.deleteExperiment", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;
  const testNamespace = `exparch-${nanoid(8)}`;

  // Tracked so the suite cleans up after itself even when an assertion
  // fails mid-test. Use the Prisma client directly here, not the router,
  // because the archive flow leaves rows behind on purpose.
  const createdExperimentIds: string[] = [];
  const createdWorkflowIds: string[] = [];
  const createdMonitorIds: string[] = [];
  const createdProjectIds: string[] = [];

  let previousApp: typeof globalForApp.__langwatch_app;

  beforeAll(async () => {
    previousApp = globalForApp.__langwatch_app;
    globalForApp.__langwatch_app = createTestApp();
    const user = await getTestUser();
    const ctx = createInnerTRPCContext({
      session: { user: { id: user.id }, expires: "1" },
    });
    caller = appRouter.createCaller(ctx);
  });

  afterAll(async () => {
    globalForApp.__langwatch_app = previousApp;
    for (const id of createdMonitorIds) {
      await prisma.monitor
        .delete({ where: { id, projectId: PROJECT_ID } })
        .catch(() => {});
    }
    for (const id of createdExperimentIds) {
      await prisma.experiment
        .delete({ where: { id, projectId: PROJECT_ID } })
        .catch(() => {});
    }
    for (const id of createdWorkflowIds) {
      await prisma.workflow
        .update({
          where: { id, projectId: PROJECT_ID },
          data: { currentVersionId: null, latestVersionId: null },
        })
        .catch(() => {});
      await prisma.workflowVersion
        .deleteMany({ where: { workflowId: id, projectId: PROJECT_ID } })
        .catch(() => {});
      await prisma.workflow
        .delete({ where: { id, projectId: PROJECT_ID } })
        .catch(() => {});
    }
    for (const pid of createdProjectIds) {
      await prisma.experiment
        .deleteMany({ where: { projectId: pid } })
        .catch(() => {});
      await prisma.project.delete({ where: { id: pid } }).catch(() => {});
    }
  });

  async function createExperiment(opts: {
    slug: string;
    projectId?: string;
    withWorkflow?: boolean;
    withMonitor?: boolean;
  }) {
    const projectId = opts.projectId ?? PROJECT_ID;
    let workflowId: string | undefined;
    if (opts.withWorkflow) {
      workflowId = `workflow_${nanoid()}`;
      await prisma.workflow.create({
        data: {
          id: workflowId,
          projectId,
          name: `${opts.slug}-workflow`,
          icon: "🔧",
          description: "test",
        },
      });
      if (projectId === PROJECT_ID) createdWorkflowIds.push(workflowId);
    }
    const id = `experiment_${nanoid()}`;
    await prisma.experiment.create({
      data: {
        id,
        name: opts.slug,
        slug: opts.slug,
        projectId,
        type: ExperimentType.BATCH_EVALUATION_V2,
        workflowId,
      },
    });
    if (projectId === PROJECT_ID) createdExperimentIds.push(id);
    if (opts.withMonitor) {
      const monitorId = `monitor_${nanoid()}`;
      await prisma.monitor.create({
        data: {
          id: monitorId,
          projectId,
          experimentId: id,
          name: `${opts.slug}-monitor`,
          slug: `${opts.slug}-monitor`,
          checkType: "custom",
          preconditions: {},
          parameters: {},
        },
      });
      if (projectId === PROJECT_ID) createdMonitorIds.push(monitorId);
    }
    return { id, workflowId };
  }

  describe("given an unarchived experiment", () => {
    describe("when the user calls deleteExperiment", () => {
      let experimentId: string;
      let originalSlug: string;

      beforeAll(async () => {
        originalSlug = `${testNamespace}-basic-${nanoid(6)}`;
        const created = await createExperiment({ slug: originalSlug });
        experimentId = created.id;
        await caller.experiments.deleteExperiment({
          projectId: PROJECT_ID,
          experimentId,
        });
      });

      /** @scenario Archiving an experiment sets archivedAt and preserves the row */
      it("preserves the row in Postgres", async () => {
        const row = await prisma.experiment.findFirst({
          where: { id: experimentId, projectId: PROJECT_ID },
        });
        expect(row).not.toBeNull();
      });

      it("sets archivedAt to a recent timestamp", async () => {
        const row = await prisma.experiment.findFirst({
          where: { id: experimentId, projectId: PROJECT_ID },
        });
        expect(row!.archivedAt!.getTime()).toBeGreaterThan(Date.now() - 10_000);
      });

      it("renames the slug so the original can be reused", async () => {
        const row = await prisma.experiment.findFirst({
          where: { id: experimentId, projectId: PROJECT_ID },
        });
        expect(row?.slug).toMatch(/-archived-/);
      });
    });
  });

  describe("given an experiment with a workflow and a monitor", () => {
    describe("when the user calls deleteExperiment", () => {
      let experimentId: string;
      let workflowId: string;

      beforeAll(async () => {
        const created = await createExperiment({
          slug: `${testNamespace}-cascade-${nanoid(6)}`,
          withWorkflow: true,
          withMonitor: true,
        });
        experimentId = created.id;
        workflowId = created.workflowId!;
        await caller.experiments.deleteExperiment({
          projectId: PROJECT_ID,
          experimentId,
        });
      });

      /** @scenario Archiving cascades to the associated workflow and hard-deletes the monitor */
      it("cascade-archives the workflow", async () => {
        const wf = await prisma.workflow.findFirst({
          where: { id: workflowId, projectId: PROJECT_ID },
        });
        expect(wf?.archivedAt).not.toBeNull();
      });

      it("hard-deletes the monitor", async () => {
        const mon = await prisma.monitor.findFirst({
          where: { experimentId, projectId: PROJECT_ID },
        });
        expect(mon).toBeNull();
      });
    });
  });

  describe("given an experiment with no workflow or monitor", () => {
    describe("when the user calls deleteExperiment", () => {
      /** @scenario Archiving without a workflow or monitor still succeeds */
      it("resolves with success", async () => {
        const { id } = await createExperiment({
          slug: `${testNamespace}-nowf-${nanoid(6)}`,
        });

        await expect(
          caller.experiments.deleteExperiment({
            projectId: PROJECT_ID,
            experimentId: id,
          }),
        ).resolves.toEqual({ success: true });
      });
    });
  });

  describe("given an already-archived experiment", () => {
    describe("when the user calls deleteExperiment a second time", () => {
      let experimentId: string;
      let firstArchivedAt: Date;

      beforeAll(async () => {
        const created = await createExperiment({
          slug: `${testNamespace}-idem-${nanoid(6)}`,
        });
        experimentId = created.id;
        await caller.experiments.deleteExperiment({
          projectId: PROJECT_ID,
          experimentId,
        });
        firstArchivedAt = (
          await prisma.experiment.findFirstOrThrow({
            where: { id: experimentId, projectId: PROJECT_ID },
          })
        ).archivedAt!;
        await new Promise((r) => setTimeout(r, 20));
        await caller.experiments.deleteExperiment({
          projectId: PROJECT_ID,
          experimentId,
        });
      });

      /** @scenario A second click on the same already-archived experiment is a no-op */
      it("does not overwrite the original archivedAt timestamp", async () => {
        const row = await prisma.experiment.findFirst({
          where: { id: experimentId, projectId: PROJECT_ID },
        });
        expect(row?.archivedAt?.getTime()).toBe(firstArchivedAt.getTime());
      });
    });
  });

  describe("given a project with one archived and one live experiment", () => {
    describe("when the user lists experiments", () => {
      let liveId: string;
      let archivedId: string;

      beforeAll(async () => {
        const live = await createExperiment({
          slug: `${testNamespace}-live-${nanoid(6)}`,
        });
        const arch = await createExperiment({
          slug: `${testNamespace}-arch-${nanoid(6)}`,
        });
        liveId = live.id;
        archivedId = arch.id;
        await caller.experiments.deleteExperiment({
          projectId: PROJECT_ID,
          experimentId: archivedId,
        });
      });

      /** @scenario Archived experiments are hidden from the standard list query */
      it("returns the live experiment", async () => {
        const list = await caller.experiments.getAllByProjectId({
          projectId: PROJECT_ID,
        });
        expect(list.map((e: { id: string }) => e.id)).toContain(liveId);
      });

      it("omits the archived experiment", async () => {
        const list = await caller.experiments.getAllByProjectId({
          projectId: PROJECT_ID,
        });
        expect(list.map((e: { id: string }) => e.id)).not.toContain(archivedId);
      });
    });
  });

  describe("given an archived experiment", () => {
    describe("when the user fetches it by the original slug", () => {
      /** @scenario A single getExperiment by id returns archived experiments as not-found */
      it("rejects with NOT_FOUND", async () => {
        const slug = `${testNamespace}-notfound-${nanoid(6)}`;
        const { id } = await createExperiment({ slug });
        await caller.experiments.deleteExperiment({
          projectId: PROJECT_ID,
          experimentId: id,
        });

        await expectTRPCError(
          caller.experiments.getExperimentBySlugOrId({
            projectId: PROJECT_ID,
            experimentSlug: slug,
          }),
          "NOT_FOUND",
        );
      });
    });
  });

  describe("given an experiment whose slug was already used and archived", () => {
    describe("when a new experiment is created with the same original slug", () => {
      it("succeeds and the new row owns the slug", async () => {
        const slug = `${testNamespace}-reuse-${nanoid(6)}`;
        const { id: firstId } = await createExperiment({ slug });
        await caller.experiments.deleteExperiment({
          projectId: PROJECT_ID,
          experimentId: firstId,
        });

        const { id: secondId } = await createExperiment({ slug });
        const row = await prisma.experiment.findFirst({
          where: { id: secondId, projectId: PROJECT_ID },
        });
        expect(row?.slug).toBe(slug);
        expect(row?.archivedAt).toBeNull();
      });
    });
  });

  // The archive path used to issue three side-effect calls that the feature
  // file forbids: a ClickHouse mass-delete (lightweight-delete masks on
  // cold-tier S3 parts), an Elasticsearch deleteByQuery on the
  // batch_evaluation index, and an in-process DSpy step cleanup. All three
  // were removed by deleting the corresponding imports from the router.
  // The most reliable proof is a source-level check: with the imports gone
  // there is no path by which the archive procedure can reach those
  // services. Runtime fail-on-call mocks were considered but rejected
  // because getClickHouseClientForProject is still used by sibling
  // list/enrichment procedures in the same router and globally mocking it
  // would break unrelated tests.
  describe("the router source file", () => {
    /** @scenario The delete-experiment code path does NOT contact ClickHouse */
    it("does not import getClickHouseClientForProject", async () => {
      const src = await import("node:fs/promises").then((fs) =>
        fs.readFile(require.resolve("../experiments.ts"), "utf8"),
      );
      expect(src).not.toMatch(/getClickHouseClientForProject/);
    });

    /** @scenario The delete-experiment code path does NOT contact Elasticsearch */
    it("does not import the Elasticsearch client or the batch_evaluation index", async () => {
      const src = await import("node:fs/promises").then((fs) =>
        fs.readFile(require.resolve("../experiments.ts"), "utf8"),
      );
      expect(src).not.toMatch(/from\s+["'][^"']*server\/elasticsearch["']/);
      expect(src).not.toMatch(/BATCH_EVALUATION_INDEX/);
    });

    /** @scenario The delete-experiment code path does NOT call the DSpy step cleanup */
    it("does not call dspySteps.steps.deleteByExperiment", async () => {
      const src = await import("node:fs/promises").then((fs) =>
        fs.readFile(require.resolve("../experiments.ts"), "utf8"),
      );
      expect(src).not.toMatch(/dspySteps\.steps\.deleteByExperiment/);
    });
  });

  describe("given an experiment that belongs to a different project", () => {
    describe("when the user calls deleteExperiment with their own projectId", () => {
      let foreignProjectId: string;
      let foreignExperimentId: string;

      beforeAll(async () => {
        foreignProjectId = `${PROJECT_ID}-other-${nanoid(6)}`;
        const sourceProject = await prisma.project.findFirstOrThrow({
          where: { id: PROJECT_ID },
          select: { teamId: true },
        });
        await prisma.project.create({
          data: {
            id: foreignProjectId,
            name: `Other ${foreignProjectId}`,
            slug: foreignProjectId,
            teamId: sourceProject.teamId,
            language: "python",
            framework: "openai",
            apiKey: `qa-key-${foreignProjectId}`,
          },
        });
        createdProjectIds.push(foreignProjectId);

        const created = await createExperiment({
          slug: `foreign-${nanoid(6)}`,
          projectId: foreignProjectId,
        });
        foreignExperimentId = created.id;
      });

      /** @scenario An experiment from another project cannot be archived */
      it("rejects with NOT_FOUND", async () => {
        await expectTRPCError(
          caller.experiments.deleteExperiment({
            projectId: PROJECT_ID,
            experimentId: foreignExperimentId,
          }),
          "NOT_FOUND",
        );
      });

      it("leaves archivedAt null on the row in the other project", async () => {
        // Make a fresh attempt before reading so this assertion is independent
        // of test ordering.
        await caller.experiments
          .deleteExperiment({
            projectId: PROJECT_ID,
            experimentId: foreignExperimentId,
          })
          .catch(() => {});

        const row = await prisma.experiment.findFirst({
          where: {
            id: foreignExperimentId,
            projectId: foreignProjectId,
          },
        });
        expect(row?.archivedAt).toBeNull();
      });
    });
  });

  describe("given an archived experiment", () => {
    describe("when a stale client autosaves with the archived id", () => {
      it("rejects with NOT_FOUND instead of mutating the archived row", async () => {
        const slug = `${testNamespace}-stale-${nanoid(6)}`;
        const { id } = await createExperiment({ slug });
        await caller.experiments.deleteExperiment({
          projectId: PROJECT_ID,
          experimentId: id,
        });

        const archived = await prisma.experiment.findFirstOrThrow({
          where: { id, projectId: PROJECT_ID },
        });

        await expectTRPCError(
          caller.experiments.saveEvaluationsV3({
            projectId: PROJECT_ID,
            experimentId: id,
            state: {
              name: "Stale autosave",
              datasets: [],
              activeDatasetId: "dataset-1",
              evaluators: [],
              targets: [],
            } as any,
          }),
          "NOT_FOUND",
        );

        const after = await prisma.experiment.findFirstOrThrow({
          where: { id, projectId: PROJECT_ID },
        });
        expect(after.slug).toBe(archived.slug);
        expect(after.archivedAt?.getTime()).toBe(archived.archivedAt?.getTime());
        expect(after.workbenchState).toEqual(archived.workbenchState);
      });
    });
  });
});
