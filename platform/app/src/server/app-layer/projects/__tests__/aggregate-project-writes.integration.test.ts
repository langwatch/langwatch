/**
 * @vitest-environment node
 *
 * ADR-144 decision 8: the aggregate is read only in v1, and the refusal is
 * the server's. Every mutation declared under a write permission on a
 * project-tier resource is refused on an aggregate before its handler runs,
 * so nothing is written under the aggregate's tenant; the same calls on a
 * member are untouched. Managing the aggregate itself (its rule, its name,
 * archiving) is declared under the organisation and project permissions and
 * stays open. Driven as an organisation admin, who passes every permission.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Project, SavedView } from "~/generated/prisma/client";
import { blankTemplate } from "~/optimization_studio/templates/blank";
import { appRouter } from "~/server/api/root";
import { handledCodeOf } from "~/server/api/routers/__tests__/helpers/aggregateTraceRoutes";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { resetAuthzGrantsCommandsForTests } from "~/server/app-layer/authz/ledger";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import { ClickHouseTraceService } from "~/server/traces/clickhouse-trace.service";
import { createAuthzTestEventSourcing } from "~/test-utils/authz-test-event-sourcing";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { AGGREGATE_PROJECT_KIND } from "../project-kinds";
import {
  type AggregateFixture,
  realAggregateProjectService,
  realOrganizationService,
  seedAggregateOrganization,
} from "./aggregateProjectFixture";

const run = nanoid(8);
const TRACE_ID = `agg-writes-${run}`;
const READ_ONLY = "aggregate_project_is_read_only";

let fixture: AggregateFixture;
let aggregate: Project;
let member: Project;
let admin: ReturnType<typeof appRouter.createCaller>;

/**
 * The six writes, each a real procedure taking the project it writes under.
 * "Experiments create" is `experiments.saveExperiment` with no experiment id;
 * a dataset is created through `dataset.upsert` with no dataset id.
 */
const WRITES = {
  "experiments.saveExperiment": (projectId: string) =>
    admin.experiments.saveExperiment({
      projectId,
      workbenchState: { name: `Eval ${run}`, step: "task" },
      dsl: { ...blankTemplate, name: `Eval ${run}` },
    }),
  "dataset.upsert": (projectId: string) =>
    admin.dataset.upsert({
      projectId,
      name: `Dataset ${run} ${nanoid(4)}`,
      columnTypes: [{ name: "input", type: "string" }],
    }),
  "annotation.create": (projectId: string) =>
    admin.annotation.create({
      projectId,
      traceId: TRACE_ID,
      comment: "a note",
      isThumbsUp: true,
      scoreOptions: {},
    }),
  "prompts.create": (projectId: string) =>
    admin.prompts.create({
      projectId,
      data: {
        handle: `bot-${nanoid(6).toLowerCase()}`,
        scope: "PROJECT",
        prompt: "You are a support bot.",
        model: "gpt-5-mini",
        inputs: [{ identifier: "question", type: "str" }],
        outputs: [{ identifier: "answer", type: "str" }],
      },
    }),
  "tracesV2.changeName": (projectId: string) =>
    admin.tracesV2.changeName({
      projectId,
      traceId: TRACE_ID,
      newName: "Renamed trace",
    }),
  "tracesV2.changeMetadata": (projectId: string) =>
    admin.tracesV2.changeMetadata({
      projectId,
      traceId: TRACE_ID,
      metadata: { reviewed: "yes" },
    }),
} as const;

const refusalOf = (write: Promise<unknown>) =>
  write.then(() => null).catch((error: unknown) => error);

/** Rows each write would leave under the project. */
const writtenUnder = async (projectId: string) => ({
  workflows: await prisma.workflow.count({ where: { projectId } }),
  experiments: await prisma.experiment.count({ where: { projectId } }),
  datasets: await prisma.dataset.count({ where: { projectId } }),
  annotations: await prisma.annotation.count({ where: { projectId } }),
  prompts: await prisma.llmPromptConfig.count({ where: { projectId } }),
  overlays: await prisma.traceEditOverlay.count({ where: { projectId } }),
});

beforeAll(async () => {
  resetAuthzGrantsCommandsForTests();
  globalForApp.__langwatch_app = createTestApp({
    organizations: realOrganizationService(prisma),
    projects: realAggregateProjectService(prisma),
    _eventSourcing: createAuthzTestEventSourcing(prisma),
  });
  // An annotation checks its trace exists in ClickHouse first; the trace
  // here is named, never stored, and resolves on the member only.
  vi.spyOn(
    ClickHouseTraceService.prototype,
    "findExistingTraceIds",
  ).mockImplementation(async ({ traceIds }) => traceIds);

  fixture = await seedAggregateOrganization(prisma, { label: "agg-writes" });
  member = fixture.shared;
  admin = appRouter.createCaller(
    createInnerTRPCContext({
      session: { user: { id: fixture.admin.id }, expires: "1" },
    }),
  );
  const { projectSlug } = await admin.project.create({
    organizationId: fixture.organizationId,
    teamId: fixture.team.id,
    name: `Company view ${run}`,
    language: "other",
    framework: "other",
    kind: AGGREGATE_PROJECT_KIND,
    aggregateRule: { kind: "explicit", projectIds: [member.id] },
  });
  aggregate = await prisma.project.findFirstOrThrow({
    where: { slug: projectSlug, teamId: fixture.team.id },
  });
});

afterAll(async () => {
  try {
    vi.restoreAllMocks();
    if (fixture) {
      const projectIds = (
        await prisma.project.findMany({
          where: { team: { organizationId: fixture.organizationId } },
          select: { id: true },
        })
      ).map((project) => project.id);
      // A workflow points at its versions, so it lets go of them first.
      await prisma.workflow.updateMany({
        where: { projectId: { in: projectIds } },
        data: { latestVersionId: null, currentVersionId: null },
      });
      await cleanupTestRows(prisma, [
        ["dashboard", { projectId: { in: projectIds } }],
        ["savedView", { projectId: { in: projectIds } }],
        ["traceEditOverlay", { projectId: { in: projectIds } }],
        ["annotation", { projectId: { in: projectIds } }],
        ["llmPromptConfigVersion", { projectId: { in: projectIds } }],
        ["llmPromptConfig", { projectId: { in: projectIds } }],
        ["datasetRecord", { projectId: { in: projectIds } }],
        ["dataset", { projectId: { in: projectIds } }],
        ["experiment", { projectId: { in: projectIds } }],
        ["workflowVersion", { projectId: { in: projectIds } }],
        ["workflow", { projectId: { in: projectIds } }],
      ]);
      await fixture.cleanup();
    }
  } finally {
    await resetApp();
    resetAuthzGrantsCommandsForTests();
  }
});

describe("Feature: every write under the aggregate's tenant is refused", () => {
  describe("given an aggregate project and one of its members", () => {
    for (const [path, write] of Object.entries(WRITES)) {
      describe(`when ana calls ${path} on the aggregate`, () => {
        /** @scenario "Every write under the aggregate's tenant is refused on the server" */
        it("is refused with the read-only code and writes nothing", async () => {
          const before = await writtenUnder(aggregate.id);

          const refusal = await refusalOf(write(aggregate.id));

          expect(handledCodeOf(refusal)).toBe(READ_ONLY);
          expect(await writtenUnder(aggregate.id)).toEqual(before);
        });
      });

      describe(`when ana calls ${path} on the member`, () => {
        it("is not refused by the aggregate guard", async () => {
          const refusal = await refusalOf(write(member.id));

          expect(refusal).toBeNull();
        });
      });
    }
  });

  describe("given an organisation admin managing the aggregate itself", () => {
    describe("when she edits its rule", () => {
      it("is allowed", async () => {
        const result = await admin.project.updateAggregateRule({
          projectId: aggregate.id,
          aggregateRule: { kind: "explicit", projectIds: [member.id] },
        });

        expect(result.success).toBe(true);
      });
    });

    describe("when she renames it", () => {
      it("is allowed", async () => {
        await admin.project.update({
          projectId: aggregate.id,
          name: `Company view renamed ${run}`,
        });

        expect(
          (
            await prisma.project.findUniqueOrThrow({
              where: { id: aggregate.id },
            })
          ).name,
        ).toBe(`Company view renamed ${run}`);
      });
    });

    describe("when she archives another project from it, and then archives it", () => {
      it("is allowed both ways", async () => {
        const spare = await fixture.makeTeamProject("spare");

        await admin.project.archiveById({
          projectId: aggregate.id,
          projectToArchiveId: spare.id,
        });
        await admin.project.archiveById({
          projectId: member.id,
          projectToArchiveId: aggregate.id,
        });

        const archived = await prisma.project.findMany({
          where: { id: { in: [spare.id, aggregate.id] } },
          select: { archivedAt: true },
        });
        expect(archived.every((project) => project.archivedAt !== null)).toBe(
          true,
        );
      });
    });
  });
});

/**
 * Two reads seed a default on first open: the reports page asks for the
 * project's first dashboard and creates one, and the trace list asks for its
 * saved views and seeds the origin views. They are queries, so the mutation
 * guard above never sees them; on an aggregate they read and write nothing.
 */
describe("Feature: opening an aggregate page never writes a default row", () => {
  const defaultsUnder = async (projectId: string) => ({
    dashboards: await prisma.dashboard.count({ where: { projectId } }),
    savedViews: await prisma.savedView.count({ where: { projectId } }),
  });

  describe("given an aggregate project and one of its members", () => {
    describe("when ana opens the aggregate's reports and trace list for the first time", () => {
      /** @scenario "Opening an aggregate page never writes a default row under it" */
      it("returns no dashboard and no views, and writes no row", async () => {
        const dashboard = await admin.dashboards.getOrCreateFirst({
          projectId: aggregate.id,
        });
        const views = await admin.savedViews.getAll({
          projectId: aggregate.id,
        });

        expect(dashboard).toBeNull();
        expect(views).toEqual([]);
        expect(await defaultsUnder(aggregate.id)).toEqual({
          dashboards: 0,
          savedViews: 0,
        });
      });
    });

    describe("when ana opens the member the same way", () => {
      /** @scenario "Opening an aggregate page never writes a default row under it" */
      it("still creates its first dashboard and default views", async () => {
        const dashboard = await admin.dashboards.getOrCreateFirst({
          projectId: member.id,
        });
        const views = await admin.savedViews.getAll({ projectId: member.id });

        expect(dashboard?.projectId).toBe(member.id);
        expect(views.length).toBeGreaterThan(0);
      });
    });
  });
});

/**
 * Saving a view writes a row under the project, but the four saved-view
 * mutations are declared under `traces:view` so a member who can only read
 * traces can still keep a view. The permission-level guard reads them as
 * reads, so each asks the write guard itself.
 */
describe("Feature: saving a view is refused on the aggregate", () => {
  /**
   * A real view under the aggregate for the rename, reorder and delete to aim
   * at. An aggregate never gets one through the app, so the test inserts it
   * directly. Without it each write would target nothing and "writes nothing"
   * would hold trivially.
   */
  const SEEDED_VIEW_ID = `seeded-${run}`;
  let seededView: SavedView;

  beforeAll(async () => {
    seededView = await prisma.savedView.create({
      data: {
        id: SEEDED_VIEW_ID,
        projectId: aggregate.id,
        name: `Seeded ${run}`,
        filters: { v: 1 },
        kind: "v2-traces-lens",
        order: 3,
      },
    });
  });

  const VIEW_WRITES = {
    "savedViews.create": (projectId: string) =>
      admin.savedViews.create({
        projectId,
        name: `Lens ${run}`,
        filters: {},
        kind: "v2-traces-lens",
        scope: "project",
      }),
    "savedViews.rename": (projectId: string) =>
      admin.savedViews.rename({
        projectId,
        viewId: SEEDED_VIEW_ID,
        name: "Renamed",
      }),
    // The seeded view sits at order 3, so an applied reorder would move it to 0.
    "savedViews.reorder": (projectId: string) =>
      admin.savedViews.reorder({ projectId, viewIds: [SEEDED_VIEW_ID] }),
    "savedViews.delete": (projectId: string) =>
      admin.savedViews.delete({ projectId, viewId: SEEDED_VIEW_ID }),
  } as const;

  describe("given an aggregate project and one of its members", () => {
    for (const [path, write] of Object.entries(VIEW_WRITES)) {
      describe(`when ana calls ${path} on the aggregate`, () => {
        /** @scenario "Saving, renaming, reordering or deleting a view is refused on the aggregate" */
        it("is refused with the read-only code and leaves the views as they were", async () => {
          const refusal = await refusalOf(write(aggregate.id));

          expect(handledCodeOf(refusal)).toBe(READ_ONLY);
          // Exactly the seeded row, untouched: no new view, and the existing
          // one keeps its name, its order and its updatedAt.
          expect(
            await prisma.savedView.findMany({
              where: { projectId: aggregate.id },
            }),
          ).toEqual([seededView]);
        });
      });
    }

    describe("when ana saves a view on the member", () => {
      /** @scenario "Saving, renaming, reordering or deleting a view is refused on the aggregate" */
      it("writes the view", async () => {
        const view = await admin.savedViews.create({
          projectId: member.id,
          name: `Lens ${run}`,
          filters: {},
          kind: "v2-traces-lens",
          scope: "project",
        });

        expect(view.projectId).toBe(member.id);
      });
    });
  });
});
