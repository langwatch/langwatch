/**
 * Instant Evals answers evaluator judges only, so an agent save naming it is refused before
 * anything is stored, while an agent stored with it earlier still reads.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import {
  INSTANT_EVAL_JUDGE_MODEL_ID,
  InstantEvalJudgeOnlyModelError,
} from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it, vi } from "vitest";

import { createAgentAppFixture } from "../app/__tests__/agent.fixture.ts";

const projectId = "project_1";

function signatureConfig(model: string) {
  return {
    prompt: "Answer clearly",
    llm: { model },
    inputs: [{ identifier: "question", type: "str" as const }],
    outputs: [{ identifier: "answer", type: "str" as const }],
  };
}

/** A signature agent written straight to the store, as one saved before the rule would be. */
async function storedAgent({
  repositories,
  id,
  model,
  project = projectId,
  copiedFromAgentId,
}: {
  repositories: ReturnType<typeof createAgentAppFixture>["repositories"];
  id: string;
  model: string;
  project?: string;
  copiedFromAgentId?: string;
}) {
  return repositories.agents.create({
    id,
    projectId: project,
    name: "Answerer",
    type: "signature",
    config: signatureConfig(model),
    ...(copiedFromAgentId ? { copiedFromAgentId } : {}),
  } as never);
}

describe("AgentModule with Instant Evals as the model", () => {
  describe("when a new agent names it", () => {
    /** @scenario "Saving Instant Evals as the model of anything but a judge is refused" */
    it("refuses as a client error and stores nothing", async () => {
      const { app, repositories } = createAgentAppFixture();
      const create = vi.spyOn(repositories.agents, "create");

      await expect(
        app.create({
          projectId,
          name: "Answerer",
          type: "signature",
          config: signatureConfig(INSTANT_EVAL_JUDGE_MODEL_ID),
        }),
      ).rejects.toThrow(InstantEvalJudgeOnlyModelError);
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("when an agent update names it", () => {
    /** @scenario "Saving Instant Evals as the model of anything but a judge is refused" */
    it("refuses as a client error and keeps the stored model", async () => {
      const { app, repositories } = createAgentAppFixture();
      const created = await app.create({
        projectId,
        name: "Answerer",
        type: "signature",
        config: signatureConfig("openai/gpt-5-mini"),
      });
      const update = vi.spyOn(repositories.agents, "update");

      await expect(
        app.update({
          id: created.id,
          projectId,
          config: signatureConfig(INSTANT_EVAL_JUDGE_MODEL_ID),
        }),
      ).rejects.toThrow(InstantEvalJudgeOnlyModelError);
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("when the agent names any other model", () => {
    /** @scenario "A prompt or an agent with any other model still saves" */
    it("stores the new agent and the update", async () => {
      const { app } = createAgentAppFixture();
      const created = await app.create({
        projectId,
        name: "Answerer",
        type: "signature",
        config: signatureConfig("openai/gpt-5-mini"),
      });

      const updated = await app.update({
        id: created.id,
        projectId,
        config: signatureConfig("anthropic/claude-sonnet-5"),
      });

      expect(updated.config).toMatchObject({ llm: { model: "anthropic/claude-sonnet-5" } });
    });
  });

  describe("when an agent was stored with it before the rule", () => {
    /** @scenario "A prompt or an agent stored with Instant Evals before this rule still reads" */
    it("reads as stored", async () => {
      const { app, repositories } = createAgentAppFixture();
      const stored = await repositories.agents.create({
        id: "agent_stored",
        projectId,
        name: "Answerer",
        type: "signature",
        config: signatureConfig(INSTANT_EVAL_JUDGE_MODEL_ID),
      } as never);

      const read = await app.getById({ id: stored.id, projectId });

      expect(read?.config).toMatchObject({ llm: { model: INSTANT_EVAL_JUDGE_MODEL_ID } });
    });

    /** @scenario "A prompt or an agent stored with Instant Evals before this rule still reads" */
    it("still takes an update that leaves its config alone", async () => {
      const { app, repositories } = createAgentAppFixture();
      const stored = await repositories.agents.create({
        id: "agent_stored",
        projectId,
        name: "Answerer",
        type: "signature",
        config: signatureConfig(INSTANT_EVAL_JUDGE_MODEL_ID),
      } as never);

      const renamed = await app.update({ id: stored.id, projectId, name: "Renamed" });

      expect(renamed.name).toBe("Renamed");
    });
  });
  describe("when a source agent stored with it is copied, pushed or synced", () => {
    /** @scenario "Saving Instant Evals as the model of anything but a judge is refused" */
    it("refuses the copy and stores no copy", async () => {
      const { app, repositories } = createAgentAppFixture();
      await storedAgent({ repositories, id: "agent_source", model: INSTANT_EVAL_JUDGE_MODEL_ID });
      const create = vi.spyOn(repositories.agents, "create");

      await expect(
        app.createCopy({
          sourceAgentId: "agent_source",
          sourceProjectId: projectId,
          targetProjectId: "project_2",
        }),
      ).rejects.toThrow(InstantEvalJudgeOnlyModelError);
      expect(create).not.toHaveBeenCalled();
    });

    /** @scenario "Saving Instant Evals as the model of anything but a judge is refused" */
    it("refuses the push and leaves every copy as it was", async () => {
      const { app, repositories } = createAgentAppFixture();
      await storedAgent({ repositories, id: "agent_source", model: INSTANT_EVAL_JUDGE_MODEL_ID });
      await storedAgent({
        repositories,
        id: "agent_copy",
        model: "openai/gpt-5-mini",
        project: "project_2",
        copiedFromAgentId: "agent_source",
      });
      const write = vi.spyOn(repositories.agents, "updateNameAndConfig");

      await expect(
        app.pushToCopies({ sourceAgentId: "agent_source", sourceProjectId: projectId }),
      ).rejects.toThrow(InstantEvalJudgeOnlyModelError);
      expect(write).not.toHaveBeenCalled();
    });

    /** @scenario "Saving Instant Evals as the model of anything but a judge is refused" */
    it("refuses the sync and leaves the copy as it was", async () => {
      const { app, repositories } = createAgentAppFixture();
      await storedAgent({ repositories, id: "agent_source", model: INSTANT_EVAL_JUDGE_MODEL_ID });
      await storedAgent({
        repositories,
        id: "agent_copy",
        model: "openai/gpt-5-mini",
        project: "project_2",
        copiedFromAgentId: "agent_source",
      });
      const write = vi.spyOn(repositories.agents, "updateNameAndConfig");

      await expect(
        app.syncFromSource({ agentId: "agent_copy", projectId: "project_2" }),
      ).rejects.toThrow(InstantEvalJudgeOnlyModelError);
      expect(write).not.toHaveBeenCalled();
    });
  });

  describe("when a source agent on any other model is copied, pushed and synced", () => {
    /** @scenario "Copying, restoring or duplicating on any other model still saves" */
    it("stores the copy and writes the source's config onto it", async () => {
      const { app, repositories } = createAgentAppFixture();
      await storedAgent({ repositories, id: "agent_source", model: "openai/gpt-5-mini" });

      const copy = await app.createCopy({
        sourceAgentId: "agent_source",
        sourceProjectId: projectId,
        targetProjectId: "project_2",
      });
      const pushed = await app.pushToCopies({
        sourceAgentId: "agent_source",
        sourceProjectId: projectId,
      });
      const synced = await app.syncFromSource({ agentId: copy.id, projectId: "project_2" });

      expect(copy.copiedFromAgentId).toBe("agent_source");
      expect(pushed.pushedTo).toBe(1);
      expect(synced).toEqual({ ok: true });
      const stored = await repositories.agents.getById({ id: copy.id, projectId: "project_2" });
      expect(stored.config).toMatchObject({ llm: { model: "openai/gpt-5-mini" } });
    });
  });
});
