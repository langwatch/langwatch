/**
 * A code evaluator running on a per-project nlpgo Lambda has to notice when
 * the engine answered with a failure.
 *
 * runCodeEvaluator guards on `response.ok`, but on the Lambda lane that was
 * computed from the INVOKE's status, which AWS sets to 200 whenever it ran the
 * function at all, so the guard never fired on SaaS and an engine failure was
 * reported as the generic "Code evaluator execution failed" with no status,
 * the same words a raised exception inside the user's code produces. These
 * tests drive the real nlpgoFetch and the real lambdaFetch, mocking only the
 * AWS client, so they cover the whole chain rather than the guard alone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { lambdaState, findFirstMock } = vi.hoisted(() => ({
  lambdaState: { handler: null as null | (() => Promise<unknown>) },
  findFirstMock: vi.fn(),
}));

vi.mock("~/env.mjs", () => ({
  env: { EVAL_MAX_PAYLOAD_BYTES: 16_000_000 },
}));

vi.mock("@aws-sdk/client-lambda", () => ({
  InvokeCommand: class {
    constructor(public input: { Payload: string }) {}
  },
}));

vi.mock("~/optimization_studio/server/lambda", () => ({
  createLambdaClient: vi.fn(() => ({
    send: vi.fn(async () => {
      if (!lambdaState.handler) {
        throw new Error("test did not script a Lambda response");
      }
      return await lambdaState.handler();
    }),
  })),
  getProjectLambdaArn: vi.fn(
    async () => "arn:aws:lambda:eu-central-1:123:function:langwatch_nlp-p1",
  ),
}));

vi.mock("~/server/s3/stagePayload", () => ({
  STAGED_PAYLOAD_HEADER: "X-Payload-S3-URL",
  stagePayloadToS3: vi.fn(),
  deleteStagedObject: vi.fn(),
}));

vi.mock("~/optimization_studio/server/addEnvs", () => ({
  addEnvs: vi.fn(async (event: unknown) => event),
}));

vi.mock("../../db", () => ({
  prisma: {
    evaluator: { findFirst: (...args: unknown[]) => findFirstMock(...args) },
  },
}));

import { LWA_PRELUDE_SEPARATOR_LEN } from "~/utils/lwaPrelude";

import { runCodeEvaluator } from "../runCodeEvaluator";

const projectId = "project_test";
const evaluatorId = "evaluator_test";

/** The engine answered with this status and body; the invocation succeeded. */
function engineAnswers({ status, body }: { status: number; body: string }) {
  lambdaState.handler = async () => ({
    StatusCode: 200,
    Payload: Buffer.concat([
      Buffer.from(JSON.stringify({ statusCode: status }), "utf-8"),
      Buffer.alloc(LWA_PRELUDE_SEPARATOR_LEN),
      Buffer.from(body, "utf-8"),
    ]),
  });
}

beforeEach(() => {
  lambdaState.handler = null;
  findFirstMock.mockReset();
  findFirstMock.mockResolvedValue({
    id: evaluatorId,
    projectId,
    type: "code",
    config: {
      code: "class Code:\n    def __call__(self, output: str):\n        ...\n",
      inputs: [{ identifier: "output", type: "str" }],
      outputs: [{ identifier: "passed", type: "bool" }],
    },
  });
  // Selects the per-project Lambda lane in nlpgoFetch.
  vi.stubEnv("LANGWATCH_NLP_LAMBDA_CONFIG", "{}");
});

function run() {
  return runCodeEvaluator({
    projectId,
    evaluatorId,
    data: { output: "x" },
    traceId: "trace_1",
    parentCausalityDepth: 0,
    parentTrace: undefined,
  });
}

describe("a code evaluator on a per-project nlpgo Lambda", () => {
  describe("when the engine answers with a 500", () => {
    /** @scenario "An engine error is reported as an error" */
    it("reports the failure and names the engine's status", async () => {
      engineAnswers({ status: 500, body: '{"message":"engine exploded"}' });

      const result = await run();

      expect(result.status).toBe("error");
      expect((result as { details: string }).details).toContain(
        "Error running code evaluator",
      );
      expect((result as { details: string }).details).toContain(
        "Internal Server Error",
      );
    });
  });

  describe("when the engine answers with a 429", () => {
    it("reports the failure rather than the generic execution message", async () => {
      engineAnswers({ status: 429, body: "rate limited" });

      const result = await run();

      expect(result.status).toBe("error");
      expect((result as { details: string }).details).not.toBe(
        "Code evaluator execution failed",
      );
      expect((result as { details: string }).details).toContain(
        "Too Many Requests",
      );
    });
  });

  describe("when the function itself crashed", () => {
    /** @scenario "A crash inside the function is not a success" */
    it("reports the crash instead of reading the invocation's 200 as an answer", async () => {
      lambdaState.handler = async () => ({
        StatusCode: 200,
        FunctionError: "Unhandled",
        Payload: Buffer.from(
          '{"errorMessage":"Runtime exited with error: signal: killed"}',
          "utf-8",
        ),
      });

      const result = await run();

      expect(result.status).toBe("error");
      expect((result as { details: string }).details).toContain("Unhandled");
    });
  });

  describe("when the engine answers with a successful evaluation", () => {
    it("returns the result, so the guard costs a passing run nothing", async () => {
      engineAnswers({
        status: 200,
        body: JSON.stringify({ status: "success", result: { passed: true } }),
      });

      const result = await run();

      expect(result.status).toBe("processed");
      expect((result as { passed: boolean }).passed).toBe(true);
    });
  });

  describe("when the engine reports a failure inside the user's code", () => {
    it("still reports the raised exception, not an HTTP failure", async () => {
      engineAnswers({
        status: 200,
        body: JSON.stringify({
          status: "error",
          error: { message: "ZeroDivisionError", traceback: "line 3" },
        }),
      });

      const result = await run();

      expect(result.status).toBe("error");
      expect((result as { details: string }).details).toBe("ZeroDivisionError");
    });
  });
});
