/**
 * @vitest-environment node
 *
 * What the application does beyond passing a call on: the config validation, the
 * workflow a second evaluator may not claim, the archive cascade and the
 * per-project filtering every replication path applies. These rules used to
 * live in the tRPC class, so the assertions are on their stable error codes.
 */
import type { Evaluator } from "@langwatch/evaluator-contract";
import { describe, expect, it, vi } from "vitest";

import type { EvaluatorGraph } from "../evaluator.app.ts";
import {
  createEvaluatorTestApp,
  testEvaluatorGraph,
  testEvaluatorPermissions,
  type EvaluatorRuntimeStubs,
} from "./evaluator.fixture.ts";

const anEvaluator: Evaluator = {
  id: "evaluator-1",
  projectId: "project-1",
  name: "Exact match",
  slug: "exact-match",
  type: "evaluator",
  config: { evaluatorType: "langevals/exact_match" },
  workflowId: null,
  copiedFromEvaluatorId: null,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const graph = testEvaluatorGraph;

function anApp(options: {
  evaluators?: EvaluatorRuntimeStubs;
  permits?: (projectId: string) => boolean;
  ports?: EvaluatorGraph;
}) {
  const ports = options.ports ?? graph();
  const permissions = testEvaluatorPermissions(options.permits ?? (() => true));
  const composed = createEvaluatorTestApp({
    // No workflow answers for an evaluator unless a case says one does: every
    // create names a workflow the project has not used before.
    evaluators: { tryGetByWorkflow: async () => null, ...options.evaluators },
    permissions,
    graph: ports,
  });

  return { ports, permissions, app: composed.app };
}

describe("given a code evaluator that arrives without its program", () => {
  it("refuses the create before anything is written", async () => {
    const create = vi.fn();
    const { app } = anApp({ evaluators: { create } });

    await expect(
      app.create({
        id: "evaluator-1",
        projectId: "project-1",
        name: "Broken code",
        type: "code",
        config: {},
      }),
    ).rejects.toMatchObject({ code: "evaluator_config_invalid" });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("given a workflow that already backs an evaluator", () => {
  it("refuses a second one against the same workflow", async () => {
    const create = vi.fn();
    const { app } = anApp({
      evaluators: { create, tryGetByWorkflow: async () => ({ ...anEvaluator, name: "Existing" }) },
    });

    await expect(
      app.create({
        id: "evaluator-2",
        projectId: "project-1",
        name: "Duplicate",
        type: "workflow",
        config: {},
        workflowId: "workflow-1",
      }),
    ).rejects.toMatchObject({
      code: "evaluator_workflow_evaluator_exists",
      httpStatus: 400,
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("when the archive confirmation is opened", () => {
  it("names the linked workflow and the monitors that go with it", async () => {
    const ports = graph({
      findMonitorsUsingEvaluator: vi.fn(async () => [{ id: "monitor-1", name: "Guard" }]),
    });
    const { app } = anApp({
      evaluators: { tryGetById: async () => ({ ...anEvaluator, workflowId: "workflow-1" }) },
      ports,
    });

    await expect(
      app.getRelatedEntities({ id: "evaluator-1", projectId: "project-1" }),
    ).resolves.toEqual({
      workflow: { id: "workflow-1", name: "Judge" },
      monitors: [{ id: "monitor-1", name: "Guard" }],
    });
  });

  it("reads no workflow for an evaluator that has none", async () => {
    const ports = graph();
    const { app } = anApp({ evaluators: { tryGetById: async () => anEvaluator }, ports });

    const related = await app.getRelatedEntities({ id: "evaluator-1", projectId: "project-1" });

    expect(related.workflow).toBeNull();
    expect(ports.findLinkedWorkflow).not.toHaveBeenCalled();
  });
});

describe("when an evaluator is cascade archived", () => {
  it("deletes its monitors, archives it, and archives its workflow", async () => {
    const ports = graph({ deleteMonitorsUsingEvaluator: vi.fn(async () => ({ count: 2 })) });
    const { app } = anApp({
      evaluators: {
        getById: async () => ({ ...anEvaluator, workflowId: "workflow-1" }),
        archive: async () => ({ ...anEvaluator, archivedAt: new Date() }),
      },
      ports,
    });

    const result = await app.cascadeArchive({ id: "evaluator-1", projectId: "project-1" });

    expect(result.deletedMonitorsCount).toBe(2);
    expect(result.archivedWorkflow).toEqual({ id: "workflow-1" });
    expect(result.evaluator.archivedAt).not.toBeNull();
  });
});

describe("given replicas that live in projects the caller cannot see", () => {
  const copies = [
    { id: "copy-1", name: "Mine", projectId: "project-2", fullPath: "a" },
    { id: "copy-2", name: "Theirs", projectId: "project-3", fullPath: "b" },
  ];

  it("lists only the ones they may view", async () => {
    const { app } = anApp({
      evaluators: { getCopies: async () => copies },
      permits: (projectId) => projectId === "project-2",
    });

    await expect(
      app.getCopies({ projectId: "project-1", evaluatorId: "evaluator-1", actorId: "user-1" }),
    ).resolves.toEqual([copies[0]]);
  });

  it("pushes only into the ones they may manage", async () => {
    const pushToCopies = vi.fn(async () => ({ pushedTo: 1, selectedCopies: 2 }));
    const { app } = anApp({
      evaluators: { getCopies: async () => copies, pushToCopies },
      permits: (projectId) => projectId === "project-2",
    });

    await app.pushToCopies({
      projectId: "project-1",
      evaluatorId: "evaluator-1",
      actorId: "user-1",
    });

    expect(pushToCopies).toHaveBeenCalledWith(
      expect.objectContaining({ allowedProjectIds: ["project-2"] }),
    );
  });
});

describe("when copying out of a project the caller cannot manage", () => {
  it("refuses before the source evaluator is read", async () => {
    const tryGetById = vi.fn();
    const { app } = anApp({ evaluators: { tryGetById }, permits: () => false });

    await expect(
      app.copy({
        evaluatorId: "evaluator-1",
        projectId: "target",
        sourceProjectId: "source",
        newEvaluatorId: "evaluator-9",
        actorId: "user-1",
      }),
    ).rejects.toMatchObject({ code: "evaluator_source_permission_denied", httpStatus: 401 });
    expect(tryGetById).not.toHaveBeenCalled();
  });

  it("refuses to sync from a source it cannot read", async () => {
    const syncFromSource = vi.fn();
    const { app } = anApp({
      evaluators: {
        getCopySource: async () => ({
          copy: anEvaluator,
          source: { ...anEvaluator, projectId: "source" },
        }),
        syncFromSource,
      },
      permits: () => false,
    });

    await expect(
      app.syncFromSource({
        projectId: "project-1",
        evaluatorId: "evaluator-1",
        actorId: "user-1",
      }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    expect(syncFromSource).not.toHaveBeenCalled();
  });
});

describe("when copying an evaluator into another project", () => {
  it("names the missing source rather than failing anonymously", async () => {
    const { app } = anApp({ evaluators: { tryGetById: async () => null } });

    await expect(
      app.copy({
        evaluatorId: "evaluator-1",
        projectId: "target",
        sourceProjectId: "source",
        newEvaluatorId: "evaluator-9",
        actorId: "user-1",
      }),
    ).rejects.toMatchObject({ code: "evaluator_not_found" });
  });

  it("refuses a workflow evaluator that names no workflow", async () => {
    const { app } = anApp({
      evaluators: {
        tryGetById: async () => ({ ...anEvaluator, type: "workflow", workflowId: null }),
      },
    });

    await expect(
      app.copy({
        evaluatorId: "evaluator-1",
        projectId: "target",
        sourceProjectId: "source",
        newEvaluatorId: "evaluator-9",
        actorId: "user-1",
      }),
    ).rejects.toMatchObject({ code: "evaluator_workflow_version_required" });
  });

  it("clones the backing workflow and points the replica at it", async () => {
    const create = vi.fn(async () => anEvaluator);
    const ports = graph();
    const { app } = anApp({
      evaluators: {
        tryGetById: async () => ({ ...anEvaluator, type: "workflow", workflowId: "workflow-1" }),
        create,
      },
      ports,
    });

    await app.copy({
      evaluatorId: "evaluator-1",
      projectId: "target",
      sourceProjectId: "source",
      newEvaluatorId: "evaluator-9",
      actorId: "user-1",
    });

    expect(ports.replicateEvaluatorWorkflow).toHaveBeenCalledWith({
      workflowId: "workflow-1",
      sourceProjectId: "source",
      targetProjectId: "target",
      actorId: "user-1",
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "evaluator-9",
        projectId: "target",
        workflowId: "workflow-2",
        copiedFromEvaluatorId: "evaluator-1",
      }),
    );
  });

  it("removes the cloned workflow when the replica cannot be written", async () => {
    const ports = graph();
    const { app } = anApp({
      evaluators: {
        tryGetById: async () => ({ ...anEvaluator, type: "workflow", workflowId: "workflow-1" }),
        create: async () => {
          throw new Error("insert failed");
        },
      },
      ports,
    });

    await expect(
      app.copy({
        evaluatorId: "evaluator-1",
        projectId: "target",
        sourceProjectId: "source",
        newEvaluatorId: "evaluator-9",
        actorId: "user-1",
      }),
    ).rejects.toThrow("insert failed");

    expect(ports.deleteReplicatedWorkflow).toHaveBeenCalledWith({
      workflowId: "workflow-2",
      projectId: "target",
    });
  });
});
