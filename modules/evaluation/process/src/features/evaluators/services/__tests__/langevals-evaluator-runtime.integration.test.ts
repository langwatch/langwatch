/**
 * @vitest-environment node
 */
import type { EvaluatorRuntimeEngine } from "@langwatch/evaluation-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  LangevalsChannel,
  LangevalsPayloadStaging,
  LangevalsPost,
} from "../../../../channels/langevals.channel.ts";
import { MemoryLangevalsChannel } from "../../../../channels/memory/memory.langevals.channel.ts";
import type { EvaluationExecutionMetricsService } from "../../../execution/services/evaluation-execution-metrics.service.ts";
import type { LangevalsEvaluateParams } from "../langevals-evaluator.service.ts";
import { LangevalsEvaluatorService } from "../langevals-evaluator.service.ts";

const { info, error } = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ info, warn: vi.fn(), error, debug: vi.fn() }),
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
  engine = "python",
  pythonEndpoint = PYTHON,
  maxRetries = 0,
  langevals,
  telemetry,
}: {
  engineOverrides: Readonly<Record<string, EvaluatorRuntimeEngine>>;
  engine?: EvaluatorRuntimeEngine;
  pythonEndpoint?: string;
  maxRetries?: number;
  langevals?: LangevalsChannel;
  telemetry?: Pick<EvaluationExecutionMetricsService, "record">;
}) {
  const channel = MemoryLangevalsChannel.create();
  const service = LangevalsEvaluatorService.create({
    config: {
      endpoint: pythonEndpoint,
      maxRetries,
      timeoutMs: 1_000,
      evaluatorRuntime: {
        endpoint: GO,
        engine,
        engineOverrides,
        internalSecret: "s3cret",
        nlpInternalSecret: "nlp-s3cret",
      },
    },
    langevals: langevals ?? channel,
    staging: createApiFixture<LangevalsPayloadStaging>(),
    telemetry,
  });
  return { channel, service };
}

/** Answers Python and Go from their own queues; a Go answer of `unreachable` fails the fetch. */
function splitChannel({
  python,
  go,
}: {
  python: Response[];
  go: Response | "unreachable";
}): LangevalsChannel & { posts: LangevalsPost[] } {
  const posts: LangevalsPost[] = [];
  return {
    posts,
    post: async (input) => {
      posts.push(input);
      if (!input.url.startsWith(GO)) {
        const answer = python.shift();
        if (!answer) throw new Error("no scripted Python answer");
        return answer;
      }
      if (go === "unreachable") throw new TypeError("fetch failed");
      return go;
    },
  };
}

beforeEach(() => {
  info.mockClear();
  error.mockClear();
});

describe("LangevalsEvaluatorService routing to the Go evaluator runtime", () => {
  describe("given langevals/exact_match is switched to the Go runtime", () => {
    /** @scenario "An evaluator switched to the Go runtime is answered by it" */
    it("is answered by Go, with the bearer, nlpgo's secret and the project, never Python", async () => {
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
        "X-LangWatch-NLP-Secret": "nlp-s3cret",
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
  describe("given langevals/exact_match is shadowed and the project sends provider credentials", () => {
    /**
     * @scenario "A shadow call carries no provider credentials"
     * @scenario "A shadow call is marked so the runtime admits it outside the project's live share"
     */
    it("sends the credentials to Python only and marks the Go call as a shadow", async () => {
      const { channel, service } = serviceRouting({
        engineOverrides: { "langevals/exact_match": "shadow" },
      });
      channel.answerWith(Response.json([{ status: "processed", score: 1 }]));
      channel.answerWith(Response.json([{ status: "processed", score: 1 }]));

      await service.evaluate({ ...params, env: { OPENAI_API_KEY: "sk-customer" } });
      await vi.waitFor(() => expect(info).toHaveBeenCalled());

      const [python, go] = channel.posts;
      expect(python?.body).toMatchObject({ env: { OPENAI_API_KEY: "sk-customer" } });
      expect(python?.headers).not.toHaveProperty("X-LangWatch-Shadow");
      expect(go?.url).toBe(`${GO}/langevals/exact_match/evaluate`);
      expect(go?.body).toMatchObject({ env: {} });
      expect(JSON.stringify(go?.body)).not.toContain("sk-customer");
      expect(go?.headers).toMatchObject({ "X-LangWatch-Shadow": "1" });
    });

    it("does not mark a call routed to Go for real", async () => {
      const { channel, service } = serviceRouting({
        engineOverrides: { "langevals/exact_match": "go" },
      });
      channel.answerWith(Response.json([{ status: "processed", score: 1 }]));

      await service.evaluate(params);

      expect(channel.posts[0]?.headers).not.toHaveProperty("X-LangWatch-Shadow");
    });
  });

  describe("given langevals/exact_match is shadowed and the Go call fails", () => {
    /** @scenario "A failing shadow call changes nothing the customer sees" */
    it.each([
      ["unavailable", Response.json({ error: { code: "internal" } }, { status: 503 })],
      [
        "busy",
        Response.json(
          { error: { code: "evaluation_busy", meta: { retryAfterMs: 2_000 } } },
          { status: 429 },
        ),
      ],
      ["unreachable", "unreachable" as const],
    ])("answers Python's retried result when Go is %s", async (_case, go) => {
      const record = vi.fn();
      const langevals = splitChannel({
        python: [
          Response.json({ detail: "booting" }, { status: 503 }),
          Response.json([{ status: "processed", score: 1, passed: true }]),
        ],
        go,
      });
      const { service } = serviceRouting({
        engineOverrides: { "langevals/exact_match": "shadow" },
        maxRetries: 1,
        langevals,
        telemetry: { record },
      });

      const result = await service.evaluate(params);
      await vi.waitFor(() => expect(info).toHaveBeenCalled());

      expect(result).toEqual({ status: "processed", score: 1, passed: true });
      expect(langevals.posts.map((post) => post.url)).toEqual([
        `${PYTHON}/langevals/exact_match/evaluate`,
        `${GO}/langevals/exact_match/evaluate`,
        `${PYTHON}/langevals/exact_match/evaluate`,
      ]);
      expect(record).toHaveBeenCalledTimes(1);
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ evaluatorType: "langevals/exact_match", status: "processed" }),
      );
      expect(info.mock.calls[0]?.[0]).toMatchObject({ go: { status: "failed" }, equal: false });
      expect(error).not.toHaveBeenCalled();
    });
  });

  describe("given the Go runtime answers that it does not know an evaluator", () => {
    const notFound = () =>
      Response.json({ error: { code: "evaluator_not_found" } }, { status: 404 });

    /** @scenario "A call the Go runtime does not serve is answered by langevals" */
    it("answers from langevals when it is deployed", async () => {
      const { channel, service } = serviceRouting({
        engineOverrides: { "langevals/valid_format": "go" },
      });
      channel.answerWith(notFound());
      channel.answerWith(Response.json([{ status: "processed", score: 1, passed: true }]));

      const result = await service.evaluate({
        ...params,
        evaluatorType: "langevals/valid_format",
        settings: { format: "python" },
      });

      expect(result).toMatchObject({ status: "processed", passed: true });
      expect(channel.posts.map((post) => post.url)).toEqual([
        `${GO}/langevals/valid_format/evaluate`,
        `${PYTHON}/langevals/valid_format/evaluate`,
      ]);
      expect(error).not.toHaveBeenCalled();
    });

    /** @scenario "A built-in evaluator the Go runtime has not ported fails as a platform error" */
    it("fails a built-in evaluator as a platform execution error when langevals is not deployed", async () => {
      const { channel, service } = serviceRouting({
        engineOverrides: { "langevals/exact_match": "go" },
        pythonEndpoint: "",
      });
      channel.answerWith(notFound());

      await expect(service.evaluate(params)).rejects.toMatchObject({
        code: "evaluator_execution_error",
        fault: "platform",
        meta: { evaluatorType: "langevals/exact_match", runtimeCode: "evaluator_not_found" },
      });
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ evaluatorType: "langevals/exact_match" }),
        expect.any(String),
      );
    });

    /** @scenario "An evaluator nobody knows stays not found when the Go runtime refuses it" */
    it("keeps an evaluator the catalogue does not know as not found", async () => {
      const { channel, service } = serviceRouting({ engineOverrides: {}, engine: "go" });
      channel.answerWith(notFound());

      await expect(
        service.evaluate({ ...params, evaluatorType: "langevals/not_a_real_one" }),
      ).rejects.toMatchObject({ code: "evaluator_not_found" });
      expect(error).not.toHaveBeenCalled();
    });
  });
});
