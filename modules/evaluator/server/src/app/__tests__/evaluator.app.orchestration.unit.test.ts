/**
 * @vitest-environment node
 *
 * What the application does beyond passing a call on: the config validation, the
 * workflow a second evaluator may not claim, the archive cascade and the
 * per-project filtering every replication path applies. These rules used to
 * live in the tRPC class, so the assertions are on their stable error codes.
 */
import { describe, expect, it, vi } from "vitest";

import type { EvaluatorGraph } from "../evaluator.app.ts";
import { MemoryEvaluatorRepository } from "../../repositories/memory/memory.evaluator.repository.ts";
import {
  createEvaluatorTestApp,
  testEvaluatorGraph,
  testEvaluatorPermissions,
} from "./evaluator.fixture.ts";

const graph = testEvaluatorGraph;

function anApp(options: {
  permits?: (projectId: string) => boolean;
  ports?: EvaluatorGraph;
  repository?: MemoryEvaluatorRepository;
} = {}) {
  const ports = options.ports ?? graph();
  const permissions = testEvaluatorPermissions(options.permits ?? (() => true));
  const composed = createEvaluatorTestApp({
    repository: options.repository,
    permissions,
    graph: ports,
  });

  return { ports, permissions, app: composed.app, repository: composed.repository };
}

describe("given a code evaluator that arrives without its program", () => {
  it("refuses the create before anything is written", async () => {
    const { app, repository } = anApp();
    const create = vi.spyOn(repository, "create");

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
    const { app, repository } = anApp();
    await repository.create({
      id: "evaluator-1",
      projectId: "project-1",
      name: "Existing",
      type: "workflow",
      config: {},
      workflowId: "workflow-1",
    });
    const create = vi.spyOn(repository, "create");

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
    const { app, repository } = anApp({ ports });
    await repository.create({
      id: "evaluator-1",
      projectId: "project-1",
      name: "Exact match",
      type: "evaluator",
      config: {},
      workflowId: "workflow-1",
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
    const { app, repository } = anApp({ ports });
    await repository.create({
      id: "evaluator-1",
      projectId: "project-1",
      name: "Exact match",
      type: "evaluator",
      config: {},
    });

    const related = await app.getRelatedEntities({ id: "evaluator-1", projectId: "project-1" });

    expect(related.workflow).toBeNull();
    expect(ports.findLinkedWorkflow).not.toHaveBeenCalled();
  });
});

describe("when an evaluator is cascade archived", () => {
  it("deletes its monitors, archives it, and archives its workflow", async () => {
    const ports = graph({ deleteMonitorsUsingEvaluator: vi.fn(async () => ({ count: 2 })) });
    const { app, repository } = anApp({ ports });
    await repository.create({
      id: "evaluator-1",
      projectId: "project-1",
      name: "Exact match",
      type: "evaluator",
      config: {},
      workflowId: "workflow-1",
    });

    const result = await app.cascadeArchive({ id: "evaluator-1", projectId: "project-1" });

    expect(result.deletedMonitorsCount).toBe(2);
    expect(result.archivedWorkflow).toEqual({ id: "workflow-1" });
    expect(result.evaluator.archivedAt).not.toBeNull();
  });
});

describe("given replicas that live in projects the caller cannot see", () => {
  async function seedCopies(repository: MemoryEvaluatorRepository) {
    await repository.create({
      id: "evaluator-1",
      projectId: "project-1",
      name: "Source",
      type: "evaluator",
      config: {},
    });
    await repository.create({
      id: "copy-1",
      projectId: "project-2",
      name: "Mine",
      type: "evaluator",
      config: {},
      copiedFromEvaluatorId: "evaluator-1",
    });
    await repository.create({
      id: "copy-2",
      projectId: "project-3",
      name: "Theirs",
      type: "evaluator",
      config: {},
      copiedFromEvaluatorId: "evaluator-1",
    });
  }

  it("lists only the ones they may view", async () => {
    const { app, repository } = anApp({ permits: (projectId) => projectId === "project-2" });
    await seedCopies(repository);

    const copies = await app.getCopies({
      projectId: "project-1",
      evaluatorId: "evaluator-1",
      actorId: "user-1",
    });

    expect(copies.map((copy) => copy.id)).toEqual(["copy-1"]);
  });

  it("pushes only into the ones they may manage", async () => {
    const { app, repository } = anApp({ permits: (projectId) => projectId === "project-2" });
    await seedCopies(repository);
    const updateNameAndConfig = vi.spyOn(repository, "updateNameAndConfig");

    await app.pushToCopies({
      projectId: "project-1",
      evaluatorId: "evaluator-1",
      actorId: "user-1",
    });

    expect(updateNameAndConfig).toHaveBeenCalledTimes(1);
    expect(updateNameAndConfig).toHaveBeenCalledWith(
      expect.objectContaining({ id: "copy-1", projectId: "project-2" }),
    );
  });
});

describe("when copying out of a project the caller cannot manage", () => {
  it("refuses before the source evaluator is read", async () => {
    const { app, repository } = anApp({ permits: () => false });
    const findById = vi.spyOn(repository, "findById");

    await expect(
      app.copy({
        evaluatorId: "evaluator-1",
        projectId: "target",
        sourceProjectId: "source",
        newEvaluatorId: "evaluator-9",
        actorId: "user-1",
      }),
    ).rejects.toMatchObject({ code: "evaluator_source_permission_denied", httpStatus: 401 });
    expect(findById).not.toHaveBeenCalled();
  });

  it("refuses to sync from a source it cannot read", async () => {
    const { app, repository } = anApp({ permits: () => false });
    await repository.create({
      id: "evaluator-1",
      projectId: "project-1",
      name: "Copy",
      type: "evaluator",
      config: {},
      copiedFromEvaluatorId: "evaluator-source",
    });
    await repository.create({
      id: "evaluator-source",
      projectId: "source",
      name: "Source",
      type: "evaluator",
      config: {},
    });
    const update = vi.spyOn(repository, "updateNameAndConfig");

    await expect(
      app.syncFromSource({
        projectId: "project-1",
        evaluatorId: "evaluator-1",
        actorId: "user-1",
      }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("when copying an evaluator into another project", () => {
  it("names the missing source rather than failing anonymously", async () => {
    const { app } = anApp();

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
    const { app, repository } = anApp();
    await repository.create({
      id: "evaluator-1",
      projectId: "source",
      name: "Source",
      type: "workflow",
      config: {},
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
    const ports = graph();
    const { app, repository } = anApp({ ports });
    await repository.create({
      id: "evaluator-1",
      projectId: "source",
      name: "Source",
      type: "workflow",
      config: {},
      workflowId: "workflow-1",
    });
    const create = vi.spyOn(repository, "create");

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
    const { app, repository } = anApp({ ports });
    await repository.create({
      id: "evaluator-1",
      projectId: "source",
      name: "Source",
      type: "workflow",
      config: {},
      workflowId: "workflow-1",
    });
    vi.spyOn(repository, "create").mockImplementationOnce(() => {
      throw new Error("insert failed");
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
