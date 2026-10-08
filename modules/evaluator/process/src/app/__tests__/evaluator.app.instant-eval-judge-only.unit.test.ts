/**
 * @vitest-environment node
 * Instant Evals answers LLM judges only, so every evaluator write refuses it on any other type
 * before storing, naming the evaluator. A row stored on it before the rule still renames.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { describe, expect, it, vi } from "vitest";

import type { MemoryEvaluatorRepository } from "../../repositories/memory/memory.evaluator.repository.ts";
import { createEvaluatorTestApp } from "./evaluator.fixture.ts";

/** Instant Evals' model id, as the evaluator stores it. */
const IE = "langwatch/instant-evals";
const ragasOnIE = { evaluatorType: "ragas/faithfulness", settings: { model: IE } };
const judgeOnIE = { evaluatorType: "langevals/llm_boolean", settings: { model: IE } };
const refusal = {
  code: "instant_eval_judge_only_model",
  httpStatus: 422,
  meta: { places: ['evaluator "Grounded"'] },
};

/** A row stored as-is, the way one saved before this rule reads. */
async function seed({
  repository,
  config,
  id = "evaluator-1",
  projectId = "project-1",
  copiedFromEvaluatorId,
}: {
  repository: MemoryEvaluatorRepository;
  config: Record<string, unknown>;
  id?: string;
  projectId?: string;
  copiedFromEvaluatorId?: string;
}) {
  return repository.create({
    id,
    projectId,
    name: "Grounded",
    type: "evaluator",
    config,
    ...(copiedFromEvaluatorId ? { copiedFromEvaluatorId } : {}),
  });
}

/** A source evaluator with one copy in another project, both on the given config. */
async function seedSourceAndCopy({
  repository,
  config,
}: {
  repository: MemoryEvaluatorRepository;
  config: Record<string, unknown>;
}) {
  await seed({ repository, config });
  await seed({
    repository,
    config: { evaluatorType: config.evaluatorType, settings: { model: "openai/gpt-5-mini" } },
    id: "copy-1",
    projectId: "project-2",
    copiedFromEvaluatorId: "evaluator-1",
  });
}

describe("given an evaluator that is not an LLM judge naming Instant Evals", () => {
  /** @scenario "An evaluator that is not an LLM judge is refused Instant Evals by name" */
  it("refuses a new evaluator before storing it", async () => {
    const { app, repository } = createEvaluatorTestApp();
    const create = vi.spyOn(repository, "create");

    await expect(
      app.create({
        id: "evaluator-1",
        projectId: "project-1",
        name: "Grounded",
        type: "evaluator",
        config: ragasOnIE,
      }),
    ).rejects.toMatchObject(refusal);
    expect(create).not.toHaveBeenCalled();
  });

  /** @scenario "An evaluator that is not an LLM judge is refused Instant Evals by name" */
  it("refuses one created through the API before storing it", async () => {
    const { app, repository } = createEvaluatorTestApp();
    const create = vi.spyOn(repository, "create");

    await expect(
      app.createWithResolvedDefaults({
        projectId: "project-1",
        name: "Grounded",
        config: ragasOnIE,
      }),
    ).rejects.toMatchObject(refusal);
    expect(create).not.toHaveBeenCalled();
  });

  /** @scenario "An evaluator that is not an LLM judge is refused Instant Evals by name" */
  it("refuses an update before storing it", async () => {
    const { app, repository } = createEvaluatorTestApp();
    await seed({
      repository,
      config: { evaluatorType: "ragas/faithfulness", settings: { model: "openai/gpt-5-mini" } },
    });
    const update = vi.spyOn(repository, "update");

    await expect(
      app.update({ id: "evaluator-1", projectId: "project-1", data: { config: ragasOnIE } }),
    ).rejects.toMatchObject(refusal);
    expect(update).not.toHaveBeenCalled();
  });

  /** @scenario "An evaluator that is not an LLM judge is refused Instant Evals by name" */
  it("refuses a copy to another project before storing it", async () => {
    const { app, repository } = createEvaluatorTestApp();
    await seed({ repository, config: ragasOnIE, projectId: "source" });
    const create = vi.spyOn(repository, "create");

    await expect(
      app.copy({
        evaluatorId: "evaluator-1",
        projectId: "target",
        sourceProjectId: "source",
        newEvaluatorId: "evaluator-9",
        actorId: "user-1",
      }),
    ).rejects.toMatchObject(refusal);
    expect(create).not.toHaveBeenCalled();
  });

  /** @scenario "An evaluator that is not an LLM judge is refused Instant Evals by name" */
  it("refuses a push to its copies before storing any", async () => {
    const { app, repository } = createEvaluatorTestApp();
    await seedSourceAndCopy({ repository, config: ragasOnIE });
    const write = vi.spyOn(repository, "updateNameAndConfig");

    await expect(
      app.pushToCopies({ projectId: "project-1", evaluatorId: "evaluator-1", actorId: "user-1" }),
    ).rejects.toMatchObject(refusal);
    expect(write).not.toHaveBeenCalled();
  });

  /** @scenario "An evaluator that is not an LLM judge is refused Instant Evals by name" */
  it("refuses a copy synced from its source before storing it", async () => {
    const { app, repository } = createEvaluatorTestApp();
    await seedSourceAndCopy({ repository, config: ragasOnIE });
    const write = vi.spyOn(repository, "updateNameAndConfig");

    await expect(
      app.syncFromSource({ projectId: "project-2", evaluatorId: "copy-1", actorId: "user-1" }),
    ).rejects.toMatchObject(refusal);
    expect(write).not.toHaveBeenCalled();
  });
});

describe("given an evaluator stored on Instant Evals outside a judge before this rule", () => {
  /** @scenario "An evaluator stored on Instant Evals outside a judge still renames" */
  it("renames it and leaves its stored model as it was", async () => {
    const { app, repository } = createEvaluatorTestApp();
    await seed({ repository, config: ragasOnIE });

    const renamed = await app.update({
      id: "evaluator-1",
      projectId: "project-1",
      data: { name: "Grounded answers" },
    });

    expect(renamed.name).toBe("Grounded answers");
    expect(renamed.config).toEqual(ragasOnIE);
  });
});

describe("given an LLM judge evaluator on Instant Evals", () => {
  /** @scenario "An LLM judge evaluator on Instant Evals still saves, copies, pushes and syncs" */
  it("creates, updates, copies, pushes and syncs it", async () => {
    const { app, repository } = createEvaluatorTestApp();

    await app.create({
      id: "evaluator-1",
      projectId: "project-1",
      name: "Grounded",
      type: "evaluator",
      config: judgeOnIE,
    });
    await app.update({ id: "evaluator-1", projectId: "project-1", data: { config: judgeOnIE } });
    const copy = await app.copy({
      evaluatorId: "evaluator-1",
      projectId: "project-2",
      sourceProjectId: "project-1",
      newEvaluatorId: "copy-1",
      actorId: "user-1",
    });
    const pushed = await app.pushToCopies({
      projectId: "project-1",
      evaluatorId: "evaluator-1",
      actorId: "user-1",
    });
    const synced = await app.syncFromSource({
      projectId: "project-2",
      evaluatorId: "copy-1",
      actorId: "user-1",
    });

    expect(copy.config).toEqual(judgeOnIE);
    expect(pushed.pushedTo).toBe(1);
    expect(synced).toEqual({ ok: true });
    expect((await repository.findById({ id: "copy-1", projectId: "project-2" }))?.config).toEqual(
      judgeOnIE,
    );
  });
});
