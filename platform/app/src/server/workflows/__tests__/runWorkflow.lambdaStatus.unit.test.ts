/**
 * A workflow run on a per-project nlpgo Lambda has to notice when the engine
 * answered with a failure.
 *
 * `runWorkflow` guards on `response.ok`, but on the Lambda lane that was
 * computed from the INVOKE's status, which AWS sets to 200 whenever it ran the
 * function at all. The guard never fired on SaaS, so the non-2xx body fell
 * through to `response.json()` and the caller got a result object whose
 * `result` and `status` are both undefined, while the error log written for
 * that case never ran. This is the one surface where a failed engine answer
 * read as a success.
 *
 * These tests drive the real `nlpgoFetch` and the real `lambdaFetch`, mocking
 * only the AWS client, so they cover the whole chain rather than the guard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { lambdaState, workflowFindUnique, versionFindUnique } = vi.hoisted(
  () => ({
    lambdaState: { handler: null as null | (() => Promise<unknown>) },
    workflowFindUnique: vi.fn(),
    versionFindUnique: vi.fn(),
  }),
);

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
    workflow: {
      findUnique: (...args: unknown[]) => workflowFindUnique(...args),
    },
    workflowVersion: {
      findUnique: (...args: unknown[]) => versionFindUnique(...args),
    },
  },
}));

vi.mock("../../api/routers/modelProviders.utils", () => ({
  getProjectModelProviders: vi.fn(async () => ({})),
}));

vi.mock("../stripUnsupportedLLMParams", () => ({
  stripUnsupportedLLMParamsFromWorkflow: vi.fn(async () => undefined),
}));

import { LWA_PRELUDE_SEPARATOR_LEN } from "~/utils/lwaPrelude";

import { WorkflowExecutionFailedError } from "../errors";
import { runWorkflow } from "../runWorkflow";

const projectId = "project_test";
const workflowId = "workflow_test";

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

/**
 * A published workflow with one entry node declaring no inputs, which is the
 * smallest shape that passes the input and LLM-key checks.
 */
const publishedDsl = {
  workflow_id: workflowId,
  spec_version: "1.5",
  name: "Test",
  icon: "",
  description: "",
  version: "1",
  enable_tracing: false,
  default_llm: { model: "openai/gpt-5-mini" },
  nodes: [
    {
      id: "entry",
      type: "entry",
      data: { outputs: [] },
    },
  ],
  edges: [],
  state: {},
};

beforeEach(() => {
  lambdaState.handler = null;
  workflowFindUnique.mockResolvedValue({
    id: workflowId,
    projectId,
    publishedId: "version_1",
  });
  versionFindUnique.mockResolvedValue({
    id: "version_1",
    projectId,
    dsl: publishedDsl,
  });
  // Selects the per-project Lambda lane in nlpgoFetch.
  vi.stubEnv("LANGWATCH_NLP_LAMBDA_CONFIG", "{}");
});

// The variable above is what selects the Lambda lane, and the unit config runs
// with `isolate: false`, so leaving it stubbed would put every later file in
// this worker on the Lambda lane too.
afterEach(() => {
  vi.unstubAllEnvs();
});

function run() {
  return runWorkflow(workflowId, projectId, {}, undefined, true, false);
}

describe("a workflow run on a per-project nlpgo Lambda", () => {
  describe("given the engine rejected the request", () => {
    /** @scenario "An engine error is reported as an error" */
    it("fails the run instead of returning a result with nothing in it", async () => {
      engineAnswers({
        status: 422,
        body: JSON.stringify({ detail: "node kind not supported" }),
      });

      await expect(run()).rejects.toBeInstanceOf(WorkflowExecutionFailedError);
    });
  });

  describe("given the function itself crashed", () => {
    /** @scenario "A crash inside the function is not a success" */
    it("fails the run", async () => {
      lambdaState.handler = async () => ({
        StatusCode: 200,
        FunctionError: "Unhandled",
        Payload: Buffer.from(
          JSON.stringify({ errorMessage: "Runtime.OutOfMemory" }),
          "utf-8",
        ),
      });

      await expect(run()).rejects.toBeInstanceOf(WorkflowExecutionFailedError);
    });
  });

  describe("given the engine ran the workflow and answered", () => {
    /** @scenario "An engine success is reported as a success" */
    it("returns the engine's own result", async () => {
      engineAnswers({
        status: 200,
        body: JSON.stringify({
          status: "success",
          result: { end: { output: "hi" } },
        }),
      });

      await expect(run()).resolves.toEqual({
        status: "success",
        result: { end: { output: "hi" } },
      });
    });
  });
});
