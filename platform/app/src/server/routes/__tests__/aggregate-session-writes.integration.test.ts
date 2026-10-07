/**
 * @vitest-environment node
 *
 * ADR-144 decision 8: nothing is written under an aggregate's tenant. The
 * tRPC permission middleware refuses project-tier write mutations at the
 * door; these session routes check their permission in the handler, so each
 * asks the write guard itself. An organisation admin, who passes every
 * permission, drives each route on an aggregate and on one of its members:
 * the aggregate is refused with the read-only code before the handler does
 * anything, and the member goes through to the work the handler does next.
 *
 * Spec: specs/governance/aggregate-project.feature
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Project } from "~/generated/prisma/client";
import {
  type AggregateFixture,
  seedAggregateOrganization,
} from "~/server/app-layer/projects/__tests__/aggregateProjectFixture";
import { prisma } from "~/server/db";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";

wireDefaultTestApp();

const session = vi.hoisted(() => ({ userId: "unset" }));
vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(async () => ({
    user: { id: session.userId },
    expires: "1",
  })),
}));

// The admin holds every permission; the guard, not the permission, is what
// these cases are about.
vi.mock("~/server/app-layer/permissions/imperative", async (importActual) => {
  const actual =
    await importActual<
      typeof import("~/server/app-layer/permissions/imperative")
    >();
  return { ...actual, probeProjectPermission: vi.fn().mockResolvedValue(true) };
});

/** The first piece of work each handler does past its checks. */
const work = vi.hoisted(() => ({
  loadExecutionData: vi.fn(),
  getRunState: vi.fn(),
  requestAbort: vi.fn(),
  getProjectModelProviders: vi.fn(),
  loadDatasets: vi.fn(),
}));

vi.mock("~/server/experiments-v3/execution/dataLoader", () => ({
  loadExecutionData: work.loadExecutionData,
}));
vi.mock("~/server/experiments-v3/execution/runStateManager", () => ({
  runStateManager: { getRunState: work.getRunState },
}));
vi.mock("~/server/experiments-v3/execution/orchestrator", () => ({
  requestAbort: work.requestAbort,
  runOrchestrator: vi.fn(),
}));
vi.mock("~/server/experiments-v3/execution/abortManager", () => ({
  abortManager: {
    requestAbort: vi.fn(),
    getRunningProjectId: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock("~/server/api/routers/modelProviders.utils", async (importActual) => ({
  ...(await importActual<
    typeof import("~/server/api/routers/modelProviders.utils")
  >()),
  getProjectModelProviders: work.getProjectModelProviders,
}));
vi.mock("~/optimization_studio/server/loadDatasets", () => ({
  loadDatasets: work.loadDatasets,
}));

const READ_ONLY = "aggregate_project_is_read_only";

let fixture: AggregateFixture;
let aggregate: Project;
let member: Project;

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

/** Each session write, and the work that shows the handler went past it. */
const ROUTES = {
  "POST /api/experiments/execute": {
    call: async (projectId: string) => {
      const { app } = await import("../experiments-v3");
      return app.request(
        "/api/experiments/execute",
        json({
          projectId,
          experimentId: "experiment_1",
          experimentSlug: "my-evaluation",
          name: "My Evaluation",
          dataset: {
            id: "ds-1",
            name: "Data",
            type: "inline",
            columns: [{ id: "input", name: "input", type: "string" }],
          },
          targets: [],
          evaluators: [],
          scope: { type: "full" },
        }),
      );
    },
    went: () => work.loadExecutionData,
  },
  "POST /api/experiments/abort": {
    call: async (projectId: string) => {
      const { app } = await import("../experiments-v3");
      return app.request(
        "/api/experiments/abort",
        json({ projectId, runId: "run_1" }),
      );
    },
    went: () => work.requestAbort,
  },
  "POST /api/playground": {
    call: async (projectId: string) => {
      const { app } = await import("../playground");
      return app.request(
        "/api/playground",
        json(
          { messages: [] },
          { "x-project-id": projectId, "x-model": "openai/gpt-5-mini" },
        ),
      );
    },
    went: () => work.getProjectModelProviders,
  },
  "POST /api/workflows/post_event": {
    call: async (projectId: string) => {
      const { app } = await import("../workflows");
      return app.request(
        "/api/workflows/post_event",
        json({ projectId, event: { type: "is_alive", payload: {} } }),
      );
    },
    went: () => work.loadDatasets,
  },
} as const;

beforeAll(async () => {
  fixture = await seedAggregateOrganization(prisma, {
    label: "agg-session-writes",
  });
  session.userId = fixture.admin.id;
  member = fixture.shared;
  aggregate = await fixture.makeAggregate("session-writes");
});

afterAll(async () => {
  await fixture?.cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  // Each stops its handler right after the guard, with an answer that is
  // not the guard's.
  work.loadExecutionData.mockResolvedValue({ error: "stopped", status: 404 });
  work.getRunState.mockImplementation(async () => ({
    runId: "run_1",
    projectId: member.id,
  }));
  work.requestAbort.mockResolvedValue(undefined);
  work.getProjectModelProviders.mockResolvedValue({});
  work.loadDatasets.mockRejectedValue(new Error("stopped"));
});

describe("Feature: session routes write nothing under an aggregate", () => {
  for (const [route, { call, went }] of Object.entries(ROUTES)) {
    describe(`when ana calls ${route} on the aggregate`, () => {
      /** @scenario "Every write under the aggregate's tenant is refused on the server" */
      it("is refused with the read-only code before the handler does any work", async () => {
        const res = await call(aggregate.id);
        const body = (await res.json()) as { error?: string };

        expect(body.error).toBe(READ_ONLY);
        expect(went()).not.toHaveBeenCalled();
      });
    });

    describe(`when ana calls ${route} on a member`, () => {
      it("goes past the guard to the handler's work", async () => {
        const res = await call(member.id);
        await res.text();

        expect(went()).toHaveBeenCalled();
      });
    });
  }
});
