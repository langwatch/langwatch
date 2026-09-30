/**
 * @vitest-environment node
 */
import type { EvaluatorRuntimeEngine } from "@langwatch/evaluation-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LangevalsEvaluateParams } from "../langevals-evaluator.service.ts";
import type { LangevalsPayloadStaging } from "../../../../channels/langevals.channel.ts";
import { MemoryLangevalsChannel } from "../../../../channels/memory/memory.langevals.channel.ts";
import { LangevalsEvaluatorService } from "../langevals-evaluator.service.ts";

const { info } = vi.hoisted(() => ({ info: vi.fn() }));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ info, warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const PYTHON = "http://langevals:5562";
const GO = "http://nlpgo:5561/go/evaluators";

const params: LangevalsEvaluateParams = {
  projectId: "project_acme",
  evaluatorType: "langevals/exact_match",
  data: { input: "hi", output: "there", expected_output: "there" },
  settings: {},
  env: {},
};

function serviceRouting({
  engineOverrides,
}: {
  engineOverrides: Readonly<Record<string, EvaluatorRuntimeEngine>>;
}) {
  const channel = MemoryLangevalsChannel.create();
  const service = LangevalsEvaluatorService.create({
    config: {
      endpoint: PYTHON,
      maxRetries: 0,
      timeoutMs: 1_000,
      evaluatorRuntime: {
        endpoint: GO,
        engine: "python",
        engineOverrides,
        internalSecret: "s3cret",
      },
    },
    langevals: channel,
    staging: createApiFixture<LangevalsPayloadStaging>(),
  });
  return { channel, service };
}

beforeEach(() => {
  info.mockClear();
});

describe("LangevalsEvaluatorService routing to the Go evaluator runtime", () => {
  describe("given langevals/exact_match is switched to the Go runtime", () => {
    /** @scenario "An evaluator switched to the Go runtime is answered by it" */
    it("is answered by Go, with the bearer and the project, and never calls Python", async () => {
      const { channel, service } = serviceRouting({
        engineOverrides: { "langevals/exact_match": "go" },
      });
      channel.answerWith(Response.json([{ status: "processed", score: 1, passed: true }]));

      const result = await service.evaluate(params);

      expect(result).toMatchObject({ status: "processed", score: 1, passed: true });
      expect(channel.posts.map((post) => post.url)).toEqual([
        `${GO}/langevals/exact_match/evaluate`,
      ]);
      expect(channel.posts[0]?.headers).toMatchObject({
        Authorization: "Bearer s3cret",
        "X-LangWatch-Project-Id": "project_acme",
      });
      expect(channel.posts[0]?.headers).not.toHaveProperty("X-LangWatch-Trace-Token");
    });
  });

  describe("given langevals/exact_match is in shadow mode", () => {
    /** @scenario "An evaluator in shadow mode answers from Python and compares with Go" */
    it("answers from Python and records the comparison without entry text", async () => {
      const { channel, service } = serviceRouting({
        engineOverrides: { "langevals/exact_match": "shadow" },
      });
      channel.answerWith(Response.json([{ status: "processed", score: 1, passed: true }]));
      channel.answerWith(Response.json([{ status: "processed", score: 0, passed: false }]));

      const result = await service.evaluate(params);

      expect(result).toMatchObject({ status: "processed", score: 1, passed: true });
      await vi.waitFor(() => expect(info).toHaveBeenCalled());
      const [line] = info.mock.calls[0] ?? [];
      expect(line).toEqual({
        evaluatorType: "langevals/exact_match",
        python: { status: "processed", score: 1 },
        go: { status: "processed", score: 0 },
        equal: false,
      });
      expect(JSON.stringify(line)).not.toContain("there");
      expect(channel.posts.map((post) => post.url)).toEqual([
        `${PYTHON}/langevals/exact_match/evaluate`,
        `${GO}/langevals/exact_match/evaluate`,
      ]);
      expect(channel.posts[1]?.headers).not.toHaveProperty("X-LangWatch-Trace-Token");
    });
  });

  describe("given langevals/exact_match was switched to Go and is switched back", () => {
    /** @scenario "Switching an evaluator back is the rollback" */
    it("answers the next run from Python", async () => {
      const switched = serviceRouting({ engineOverrides: { "langevals/exact_match": "go" } });
      switched.channel.answerWith(Response.json([{ status: "processed", score: 1 }]));
      await switched.service.evaluate(params);
      expect(switched.channel.posts[0]?.url).toBe(`${GO}/langevals/exact_match/evaluate`);

      const { channel, service } = serviceRouting({ engineOverrides: {} });
      channel.answerWith(Response.json([{ status: "processed", score: 1 }]));

      await service.evaluate(params);

      expect(channel.posts.map((post) => post.url)).toEqual([
        `${PYTHON}/langevals/exact_match/evaluate`,
      ]);
      expect(channel.posts[0]?.headers).not.toHaveProperty("Authorization");
    });
  });

  describe("given the Go runtime refuses the call as busy", () => {
    it("throws evaluation_busy carrying the retry delay", async () => {
      const { channel, service } = serviceRouting({
        engineOverrides: { "langevals/exact_match": "go" },
      });
      channel.answerWith(
        Response.json(
          { error: { code: "evaluation_busy", meta: { retryAfterMs: 2_000 } } },
          { status: 429 },
        ),
      );

      await expect(service.evaluate(params)).rejects.toMatchObject({
        code: "evaluation_busy",
        meta: { retryAfterMs: 2_000 },
      });
    });
  });

  describe("given the Go runtime refuses the internal credential", () => {
    it("throws an execution failure naming the runtime's code, without the HTTP status", async () => {
      const { channel, service } = serviceRouting({
        engineOverrides: { "langevals/exact_match": "go" },
      });
      channel.answerWith(Response.json({ error: { code: "unauthorized" } }, { status: 401 }));

      const error = await service.evaluate(params).catch((thrown: unknown) => thrown);

      expect(error).toMatchObject({
        code: "evaluator_execution_error",
        meta: { runtimeCode: "unauthorized" },
      });
      expect(error).not.toHaveProperty("meta.httpStatus");
    });
  });
});
