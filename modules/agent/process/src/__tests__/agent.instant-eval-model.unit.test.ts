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
});
