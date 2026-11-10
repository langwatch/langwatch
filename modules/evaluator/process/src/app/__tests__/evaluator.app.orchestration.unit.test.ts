/**
 * @vitest-environment node
 * What the application does beyond passing a call on: config
 * validation, workflow/archive rules, and per-project filtering. These
 * moved out of the tRPC class, so assertions target stable error codes.
 * @see modules/evaluator/specs/evaluator-deleted-fact.feature
 * @see modules/evaluator/specs/evaluator-created-fact.feature
 */
import type * as Observability from "@langwatch/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MemoryEvaluatorRepository } from "../../repositories/memory/memory.evaluator.repository.ts";
import type { EvaluatorGraph } from "../evaluator.app.ts";
import {
  createEvaluatorTestApp,
  testEvaluatorGraph,
  testEvaluatorPermissions,
} from "./evaluator.fixture.ts";

const graph = testEvaluatorGraph;

/** Every error line any evaluator logger writes, so a lost created fact can be checked. */
const loggedErrors = vi.hoisted((): { fields: unknown; message: unknown }[] => []);
vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof Observability>()),
  createLogger: () => ({
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (fields: unknown, message: unknown) => void loggedErrors.push({ fields, message }),
  }),
}));

const lostCreatedFacts = () =>
  loggedErrors.filter(
    (e) =>
      typeof e.message === "string" &&
      e.message.startsWith("evaluator created fact was not recorded"),
  );

/** Connects a created-fact sender that keeps what it is sent. */
function recordingCreatedFacts(app: ReturnType<typeof anApp>["app"]) {
  const sent: unknown[] = [];
  app.connectLifecycle({
    recordEvaluatorDeleted: { send: async () => undefined },
    recordEvaluatorCreated: { send: async (data) => void sent.push(data) },
  });
  return sent;
}

function anApp(
  options: {
    permits?: (projectId: string) => boolean;
    ports?: EvaluatorGraph;
    repository?: MemoryEvaluatorRepository;
  } = {},
) {
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
  /** @scenario "the archive confirmation names only the linked workflow" */
  it("names the linked workflow, and leaves the monitors to monitor", async () => {
    const ports = graph();
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
  /** @scenario "a cascade archive records that the evaluator was deleted" */
  it("archives it and its workflow, then records the deleted fact", async () => {
    const { app, repository } = anApp();
    const sent: unknown[] = [];
    app.connectLifecycle({
      recordEvaluatorDeleted: { send: async (data) => void sent.push(data) },
      recordEvaluatorCreated: { send: async () => undefined },
    });
    await repository.create({
      id: "evaluator-1",
      projectId: "project-1",
      name: "Exact match",
      type: "evaluator",
      config: {},
      workflowId: "workflow-1",
    });

    const result = await app.cascadeArchive({ id: "evaluator-1", projectId: "project-1" });

    expect(result).not.toHaveProperty("deletedMonitorsCount");
    expect(result.archivedWorkflow).toEqual({ id: "workflow-1" });
    expect(result.evaluator.archivedAt).not.toBeNull();
    expect(sent).toEqual([
      {
        tenantId: "project-1",
        projectId: "project-1",
        evaluatorId: "evaluator-1",
        occurredAt: expect.any(Number),
      },
    ]);
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

  /** @scenario "copying an evaluator into another project records the copy as created" */
  it("records one created fact for the copy, keyed to the target project", async () => {
    const { app, repository } = anApp();
    const sent = recordingCreatedFacts(app);
    await repository.create({
      id: "evaluator-1",
      projectId: "project-1",
      name: "Exact match",
      type: "evaluator",
      config: {},
    });

    await app.copy({
      evaluatorId: "evaluator-1",
      projectId: "project-2",
      sourceProjectId: "project-1",
      newEvaluatorId: "evaluator-copy",
      actorId: "user-1",
      shouldCheckEvaluatorCap: false,
    });

    expect(sent).toEqual([
      {
        tenantId: "project-2",
        projectId: "project-2",
        evaluatorId: "evaluator-copy",
        occurredAt: expect.any(Number),
      },
    ]);
  });
});

describe("when an evaluator is created", () => {
  beforeEach(() => {
    loggedErrors.length = 0;
  });

  /** @scenario "creating an evaluator records that it was created" */
  it("records one created fact of ids only, after the row exists", async () => {
    const { app, repository } = anApp();
    const sent: unknown[] = [];
    let rowExisted = false;
    app.connectLifecycle({
      recordEvaluatorDeleted: { send: async () => undefined },
      recordEvaluatorCreated: {
        send: async (data) => {
          rowExisted =
            (await repository.findById({ id: "evaluator-1", projectId: "project-1" })) !==
            undefined;
          sent.push(data);
        },
      },
    });

    await app.create({
      id: "evaluator-1",
      projectId: "project-1",
      name: "Exact match",
      type: "evaluator",
      config: {},
    });

    expect(rowExisted).toBe(true);
    expect(sent).toEqual([
      {
        tenantId: "project-1",
        projectId: "project-1",
        evaluatorId: "evaluator-1",
        occurredAt: expect.any(Number),
      },
    ]);
  });

  /** @scenario "a lost created fact never fails the create" */
  it("creates the evaluator when evaluator_lifecycle is not registered, and logs the lost fact", async () => {
    const { app } = anApp();

    const created = await app.create({
      id: "evaluator-1",
      projectId: "project-1",
      name: "Exact match",
      type: "evaluator",
      config: {},
    });

    expect(created.id).toBe("evaluator-1");
    expect(lostCreatedFacts()).toEqual([
      {
        fields: { tenantId: "project-1", projectId: "project-1", evaluatorId: "evaluator-1" },
        message: expect.any(String),
      },
    ]);
  });

  /** @scenario "a lost created fact never fails the create" */
  it("creates the evaluator when the record fails, and logs the lost fact", async () => {
    const { app } = anApp();
    app.connectLifecycle({
      recordEvaluatorDeleted: { send: async () => undefined },
      recordEvaluatorCreated: {
        send: async () => {
          throw new Error("queue down");
        },
      },
    });

    const created = await app.create({
      id: "evaluator-1",
      projectId: "project-1",
      name: "Exact match",
      type: "evaluator",
      config: {},
    });

    expect(created.id).toBe("evaluator-1");
    expect(lostCreatedFacts()).toEqual([
      {
        fields: expect.objectContaining({
          tenantId: "project-1",
          projectId: "project-1",
          evaluatorId: "evaluator-1",
        }),
        message: expect.any(String),
      },
    ]);
  });

  /** @scenario "creating an evaluator records that it was created" */
  it("records one created fact when the public API creates on resolved models", async () => {
    const { app } = anApp();
    const sent = recordingCreatedFacts(app);

    await app.createWithResolvedDefaults({
      id: "evaluator-1",
      projectId: "project-1",
      name: "Exact match",
      config: { evaluatorType: "ragas/faithfulness" },
    });

    expect(sent).toEqual([
      {
        tenantId: "project-1",
        projectId: "project-1",
        evaluatorId: "evaluator-1",
        occurredAt: expect.any(Number),
      },
    ]);
  });

  /** @scenario "creating an evaluator records that it was created" */
  it("records one created fact when the caller already resolved the models", async () => {
    const { app } = anApp();
    const sent = recordingCreatedFacts(app);

    await app.createWithDefaults({
      id: "evaluator-1",
      projectId: "project-1",
      name: "Exact match",
      type: "evaluator",
      config: { evaluatorType: "ragas/faithfulness" },
    });

    expect(sent).toEqual([
      {
        tenantId: "project-1",
        projectId: "project-1",
        evaluatorId: "evaluator-1",
        occurredAt: expect.any(Number),
      },
    ]);
  });
});
