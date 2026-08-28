/**
 * @vitest-environment node
 *
 * The permission each monitor and evaluator procedure demands, read off the
 * real mounts rather than off the package's own harness.
 *
 * Two things are pinned. The first is the grain: `evaluations:view` to read,
 * `:create` to add a monitor, `:update` to change one, `:delete` to remove one,
 * `:manage` for everything that crosses a project boundary — widening any of
 * them refuses least-privilege keys the product itself accepts.
 *
 * The second is subtler and is why the mount exists in this shape at all: the
 * declared check resolves its scope id from the VALIDATED input, so it can only
 * run after the input parser. A policy composed ahead of `.input()` sees no
 * input, resolves no scope, and would never reach the authorization service —
 * `permissionsAsked` would come back empty while every guard stayed green.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { permissionsAsked, monitors, evaluations, evaluators, prisma } = vi.hoisted(() => ({
  permissionsAsked: [] as string[],
  monitors: {
    getAllForProject: vi.fn(async () => []),
    getById: vi.fn(async () => ({ evaluatorId: null })),
    toggle: vi.fn(async () => ({ success: true })),
    create: vi.fn(async () => ({ id: "monitor-1" })),
    update: vi.fn(async () => ({ id: "monitor-1" })),
    delete: vi.fn(async () => ({ success: true })),
    isNameAvailable: vi.fn(async () => ({ available: true })),
    replicate: vi.fn(async () => ({ id: "monitor-2" })),
  },
  evaluations: { getMonitorPerformance: vi.fn(async () => []) },
  evaluators: {
    getAllWithFields: vi.fn(async () => []),
    tryGetByIdWithFields: vi.fn(async () => null),
    tryGetBySlug: vi.fn(async () => null),
    tryGetById: vi.fn(async () => null),
    tryGetByWorkflow: vi.fn(async () => null),
    getById: vi.fn(async () => ({ workflowId: null })),
    create: vi.fn(async () => ({ id: "evaluator-1" })),
    update: vi.fn(async () => ({ id: "evaluator-1" })),
    archive: vi.fn(async () => ({ id: "evaluator-1" })),
    getWorkflowFields: vi.fn(async () => ({ fields: [], outputFields: [] })),
    getCopies: vi.fn(async () => []),
    pushToCopies: vi.fn(async () => ({ pushedTo: 0, selectedCopies: 0 })),
    getCopySource: vi.fn(async () => ({ copy: {}, source: { projectId: "project-2" } })),
    syncFromSource: vi.fn(async () => ({ ok: true })),
    getHistory: vi.fn(async () => []),
  },
  prisma: {
    monitor: { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 0 })) },
    workflow: {
      findFirst: vi.fn(async () => null),
      update: vi.fn(async () => ({ id: "workflow-1" })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}));

vi.mock("~/server/app-layer/app", () => ({
  tryGetApp: () => null,
  getApp: () => ({
    monitors,
    evaluations,
    evaluators,
    permissions: {
      getDecision: async ({ permission }: { permission: string }) => {
        permissionsAsked.push(permission);
        return { permitted: true, organizationRole: null };
      },
      // Every declared check runs behind the lineage guard; these inputs are
      // single-tenant, so it is always consistent here.
      checkScopeLineage: async () => ({ kind: "consistent" }),
    },
  }),
}));
vi.mock("~/runtime/app/features/audit-log", () => ({ auditLog: vi.fn() }));

import { createInnerTRPCContext } from "~/server/api/trpc";

import { evaluatorsRouter } from "../evaluator.router";
import { monitorsRouter } from "../monitor.router";

function callers() {
  const ctx = createInnerTRPCContext({
    session: { user: { id: "user-1" }, expires: "1" } as never,
    permissionChecked: false,
  });
  ctx.prisma = prisma as never;
  return {
    monitors: monitorsRouter.createCaller(ctx),
    evaluators: evaluatorsRouter.createCaller(ctx),
  };
}

const projectScope = { projectId: "project-1" };
const idScope = { id: "record-1", projectId: "project-1" };
const evaluatorScope = { projectId: "project-1", evaluatorId: "evaluator-1" };
const crossProject = { projectId: "project-1", sourceProjectId: "project-2" };
const monitorWrite = {
  projectId: "project-1",
  name: "Guard",
  checkType: "workflow",
  preconditions: [],
  settings: {},
  sample: 1,
  executionMode: "ON_MESSAGE" as const,
};

const monitorProcedures: Array<
  [string, (c: ReturnType<typeof callers>) => Promise<unknown>, string[]]
> = [
  ["getAllForProject", (c) => c.monitors.getAllForProject(projectScope), ["evaluations:view"]],
  [
    "getPerformanceForProject",
    (c) => c.monitors.getPerformanceForProject(projectScope),
    ["evaluations:view", "analytics:view"],
  ],
  ["toggle", (c) => c.monitors.toggle({ ...idScope, enabled: true }), ["evaluations:update"]],
  ["create", (c) => c.monitors.create(monitorWrite), ["evaluations:create"]],
  [
    "copy",
    (c) => c.monitors.copy({ monitorId: "monitor-1", ...crossProject }),
    // The declared check, then the probe on the project being copied FROM.
    ["evaluations:manage", "evaluations:manage"],
  ],
  [
    "update",
    (c) => c.monitors.update({ ...monitorWrite, id: "monitor-1", mappings: {} }),
    ["evaluations:update"],
  ],
  ["getById", (c) => c.monitors.getById(idScope), ["evaluations:view"]],
  ["delete", (c) => c.monitors.delete(idScope), ["evaluations:delete"]],
  [
    "isNameAvailable",
    (c) => c.monitors.isNameAvailable({ projectId: "project-1", name: "Guard" }),
    ["evaluations:view"],
  ],
];

const evaluatorProcedures: Array<
  [string, (c: ReturnType<typeof callers>) => Promise<unknown>, string[]]
> = [
  ["getAll", (c) => c.evaluators.getAll(projectScope), ["evaluations:view"]],
  ["getById", (c) => c.evaluators.getById(idScope), ["evaluations:view"]],
  [
    "getBySlug",
    (c) => c.evaluators.getBySlug({ slug: "exact", projectId: "project-1" }),
    ["evaluations:view"],
  ],
  [
    "create",
    (c) =>
      c.evaluators.create({
        projectId: "project-1",
        name: "Exact",
        type: "evaluator",
        config: {},
      }),
    ["evaluations:manage"],
  ],
  ["update", (c) => c.evaluators.update(idScope), ["evaluations:manage"]],
  ["getRelatedEntities", (c) => c.evaluators.getRelatedEntities(idScope), ["evaluations:view"]],
  ["cascadeArchive", (c) => c.evaluators.cascadeArchive(idScope), ["evaluations:manage"]],
  ["delete", (c) => c.evaluators.delete(idScope), ["evaluations:manage"]],
  ["getWorkflowFields", (c) => c.evaluators.getWorkflowFields(idScope), ["evaluations:view"]],
  ["getCopies", (c) => c.evaluators.getCopies(evaluatorScope), ["evaluations:view"]],
  [
    "copy",
    (c) => c.evaluators.copy({ evaluatorId: "evaluator-1", ...crossProject }),
    // The declared check, then the probe on the project being copied FROM.
    ["evaluations:manage", "evaluations:manage"],
  ],
  ["pushToCopies", (c) => c.evaluators.pushToCopies(evaluatorScope), ["evaluations:manage"]],
  [
    "syncFromSource",
    (c) => c.evaluators.syncFromSource(evaluatorScope),
    // The declared check, then the probe on the source evaluator's project.
    ["evaluations:manage", "evaluations:manage"],
  ],
  [
    "getHistory",
    (c) => c.evaluators.getHistory({ evaluatorId: "evaluator-1", projectId: "project-1" }),
    ["evaluations:view"],
  ],
];

beforeEach(() => {
  permissionsAsked.length = 0;
});

describe("monitor and evaluator access gates", () => {
  describe("when a monitor procedure runs", () => {
    it.each(monitorProcedures)(
      "asks %s for exactly its declared grain",
      async (_name, run, expected) => {
        await run(callers()).catch(() => undefined);

        expect(permissionsAsked).toEqual(expected);
      },
    );
  });

  describe("when an evaluator procedure runs", () => {
    it.each(evaluatorProcedures)(
      "asks %s for exactly its declared grain",
      async (_name, run, expected) => {
        await run(callers()).catch(() => undefined);

        expect(permissionsAsked).toEqual(expected);
      },
    );
  });
});
