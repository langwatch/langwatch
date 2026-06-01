/**
 * @vitest-environment node
 *
 * Integration tests for experiment archive (formerly delete).
 *
 * Covers specs/experiments-v3/experiment-archive.feature. No mocks: runs the
 * real tRPC mutation against a real Postgres test instance and asserts on the
 * persisted rows directly.
 *
 * Rationale: the old deleteExperiment path was hard-deleting Postgres rows
 * AND issuing DELETE FROM in ClickHouse plus deleteByQuery in Elasticsearch.
 * Every click cost ~$1-2 in S3 request churn (mask writes on every cold-tier
 * part + merge fallout). The codebase had already standardised on archivedAt
 * for Workflow/Monitor/Dataset/Evaluator/Agent/Project/Team; Experiment was
 * the outlier. This file pins the new soft-archive behaviour so future edits
 * cannot silently regress to hard delete.
 */
import { ExperimentType } from "@prisma/client";
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

describe("Experiment archive (formerly delete)", () => {
  const projectId = "test-project-id";
  let caller: ReturnType<typeof appRouter.createCaller>;
  const testNamespace = `exparch-${nanoid(8)}`;

  // Track resources so the suite cleans up after itself even if an assertion
  // fails mid-test. We use the Prisma client directly here (not the router)
  // because the router's archive flow now leaves rows behind on purpose.
  const createdExperimentIds: string[] = [];
  const createdWorkflowIds: string[] = [];
  const createdMonitorIds: string[] = [];

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
      await prisma.monitor.delete({ where: { id, projectId } }).catch(() => {});
    }
    for (const id of createdExperimentIds) {
      await prisma.experiment
        .delete({ where: { id, projectId } })
        .catch(() => {});
    }
    for (const id of createdWorkflowIds) {
      await prisma.workflow
        .update({
          where: { id, projectId },
          data: { currentVersionId: null, latestVersionId: null },
        })
        .catch(() => {});
      await prisma.workflowVersion
        .deleteMany({ where: { workflowId: id, projectId } })
        .catch(() => {});
      await prisma.workflow
        .delete({ where: { id, projectId } })
        .catch(() => {});
    }
  });

  async function createExperiment(opts: {
    slug: string;
    withWorkflow?: boolean;
    withMonitor?: boolean;
  }) {
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
      createdWorkflowIds.push(workflowId);
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
    createdExperimentIds.push(id);
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
      createdMonitorIds.push(monitorId);
    }
    return { id, workflowId };
  }

  it("archives the experiment row instead of deleting it", async () => {
    const { id } = await createExperiment({
      slug: `${testNamespace}-basic-${nanoid(6)}`,
    });

    await caller.experiments.deleteExperiment({ projectId, experimentId: id });

    const row = await prisma.experiment.findFirst({ where: { id, projectId } });
    expect(row).not.toBeNull();
    expect(row?.archivedAt).not.toBeNull();
    expect(row!.archivedAt!.getTime()).toBeGreaterThan(Date.now() - 10_000);
    // Slug was renamed so a future experiment can reuse the original slug.
    expect(row?.slug).toMatch(/-archived-/);
  });

  it("cascade-archives the linked workflow and hard-deletes the monitor", async () => {
    const { id, workflowId } = await createExperiment({
      slug: `${testNamespace}-cascade-${nanoid(6)}`,
      withWorkflow: true,
      withMonitor: true,
    });

    await caller.experiments.deleteExperiment({ projectId, experimentId: id });

    const wf = await prisma.workflow.findFirst({
      where: { id: workflowId!, projectId },
    });
    expect(wf?.archivedAt).not.toBeNull();

    // Monitor has no archivedAt column; we keep the historical hard-delete
    // because monitors are small relational rows with no S3 implication.
    const mon = await prisma.monitor.findFirst({
      where: { experimentId: id, projectId },
    });
    expect(mon).toBeNull();
  });

  it("handles an experiment with no workflow or monitor without erroring", async () => {
    const { id } = await createExperiment({
      slug: `${testNamespace}-nowf-${nanoid(6)}`,
    });

    await expect(
      caller.experiments.deleteExperiment({ projectId, experimentId: id }),
    ).resolves.toEqual({ success: true });
  });

  it("is idempotent — a second click does not overwrite archivedAt", async () => {
    const { id } = await createExperiment({
      slug: `${testNamespace}-idem-${nanoid(6)}`,
    });

    await caller.experiments.deleteExperiment({ projectId, experimentId: id });
    const firstArchive = (
      await prisma.experiment.findFirst({ where: { id, projectId } })
    )?.archivedAt;

    // Tiny pause so a re-set timestamp would observably differ.
    await new Promise((r) => setTimeout(r, 20));

    await caller.experiments.deleteExperiment({ projectId, experimentId: id });
    const secondArchive = (
      await prisma.experiment.findFirst({ where: { id, projectId } })
    )?.archivedAt;

    expect(firstArchive).toEqual(secondArchive);
  });

  it("hides archived experiments from the project-wide list (Postgres path)", async () => {
    const liveSlug = `${testNamespace}-live-${nanoid(6)}`;
    const archivedSlug = `${testNamespace}-arch-${nanoid(6)}`;
    const { id: liveId } = await createExperiment({ slug: liveSlug });
    const { id: archivedId } = await createExperiment({ slug: archivedSlug });

    await caller.experiments.deleteExperiment({
      projectId,
      experimentId: archivedId,
    });

    // getAllByProjectId goes through the repository's findAll, which is
    // pure Postgres — no ClickHouse enrichment. That is the layer we need
    // to verify here (the run-count enrichment in getAllForEvaluationsList
    // happens after this list filter and is tested elsewhere).
    const list = await caller.experiments.getAllByProjectId({ projectId });

    const ids = list.map((e: { id: string }) => e.id);
    expect(ids).toContain(liveId);
    expect(ids).not.toContain(archivedId);
  });

  it("returns NOT_FOUND when fetching an archived experiment by slug", async () => {
    const slug = `${testNamespace}-notfound-${nanoid(6)}`;
    const { id } = await createExperiment({ slug });
    await caller.experiments.deleteExperiment({ projectId, experimentId: id });

    // The slug was rewritten on archive, so the original slug should now
    // resolve to null/NOT_FOUND.
    await expect(
      caller.experiments.getExperimentBySlugOrId({
        projectId,
        experimentSlug: slug,
      }),
    ).rejects.toThrow();
  });

  it("frees up the original slug so a new experiment can take it", async () => {
    const slug = `${testNamespace}-reuse-${nanoid(6)}`;
    const { id: firstId } = await createExperiment({ slug });

    await caller.experiments.deleteExperiment({
      projectId,
      experimentId: firstId,
    });

    // Now create a new experiment with the same slug — should succeed.
    const { id: secondId } = await createExperiment({ slug });
    const row = await prisma.experiment.findFirst({
      where: { id: secondId, projectId },
    });
    expect(row?.slug).toBe(slug);
    expect(row?.archivedAt).toBeNull();
  });
});
