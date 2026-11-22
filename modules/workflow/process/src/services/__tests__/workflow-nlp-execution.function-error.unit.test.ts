/** @see modules/workflow/specs/studio-lambda-stream.feature */
import type * as TestHarness from "@langwatch/test-harness";
import type { StudioClientEvent } from "@langwatch/workflow-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  lines: [] as { level: number; msg?: string; [field: string]: unknown }[],
}));

vi.mock("@langwatch/observability", async (importOriginal) => {
  const harness = await vi.importActual<typeof TestHarness>("@langwatch/test-harness");
  const { logger, lines } = harness.createTestLogger();
  captured.lines = lines;
  return { ...(await importOriginal<object>()), createLogger: () => logger };
});

import type { WorkflowNlpDispatchResponse } from "../../app/workflow.app.ts";
import { WorkflowNlpExecutionService } from "../workflow-nlp-execution.service.ts";
import { TestModelProviderService } from "./model-provider.service.fake.ts";

const input = {
  projectId: "project_1",
  workflowId: "workflow_1",
  inputs: { ticket: "42", trace_id: "trace_generated" },
  version: {
    id: "version_1",
    workflowId: "workflow_1",
    projectId: "project_1",
    version: "1",
    autoSaved: false,
    commitMessage: "first",
    authorId: null,
    parentId: null,
    dsl: {
      spec_version: "1.5",
      workflow_id: "workflow_1",
      name: "Triage",
      icon: "",
      description: "",
      version: "1",
      nodes: [],
      edges: [],
      state: {},
      template_adapter: "default",
      enable_tracing: true,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

const executeAnswering = (answer: WorkflowNlpDispatchResponse) =>
  WorkflowNlpExecutionService.create({
    ids: { next: () => "generated" },
    modelProviders: new TestModelProviderService(),
    nlpRuntime: { dispatch: async () => answer },
    studioEvents: {
      enrich: async (event: { event: StudioClientEvent }) => event.event,
      prepare: async (event: { event: StudioClientEvent }) => event.event,
    },
  }).execute(input);

const failedWith = (body: string): WorkflowNlpDispatchResponse => ({
  ok: false,
  status: 502,
  statusText: "Unhandled",
  json: async () => JSON.parse(body) as unknown,
  text: async () => body,
});

/** pino's numeric error level. */
const ERROR_LEVEL = 50;

const WARN_LEVEL = 40;

const warnLine = () => captured.lines.find((line) => line.level === WARN_LEVEL);

const errorLine = () => captured.lines.find((line) => line.level === ERROR_LEVEL);

describe("WorkflowNlpExecutionService", () => {
  beforeEach(() => {
    captured.lines.length = 0;
  });

  describe("when the engine's runtime raised", () => {
    /** @scenario "A run the engine's function raised on names the cause in the log" */
    it("logs the raised error's type and capped message, and nothing else", async () => {
      const body = JSON.stringify({
        errorType: "Runtime.ExitError",
        errorMessage: `RequestId: abc Error: Runtime exited ${"x".repeat(5000)}`,
        trace: ["line one", "line two"],
      });

      await expect(executeAnswering(failedWith(body))).rejects.toMatchObject({
        code: "workflow_execution_failed",
      });

      const line = errorLine();
      expect(line).toMatchObject({
        status: 502,
        statusText: "Unhandled",
        errorType: "Runtime.ExitError",
        errorMessage: expect.stringMatching(/^RequestId: abc Error/),
      });
      expect(String(line?.errorMessage)).toHaveLength(1000);
      expect(line).not.toHaveProperty("trace");
    });
  });

  describe("when the workflow's answer is over the synchronous response cap", () => {
    /** @scenario "A workflow result too large for one synchronous answer is the sender's to shrink" */
    it("refuses as the sender's to shrink and logs a warning, not an error", async () => {
      const body = JSON.stringify({
        errorType: "Function.ResponseSizeTooLarge",
        errorMessage:
          "Response payload size exceeded maximum allowed payload size (6291556 bytes).",
      });

      await expect(executeAnswering(failedWith(body))).rejects.toMatchObject({
        code: "workflow_result_too_large",
        fault: "customer",
        httpStatus: 422,
      });

      expect(errorLine()).toBeUndefined();
      expect(warnLine()).toMatchObject({
        status: 502,
        errorType: "Function.ResponseSizeTooLarge",
      });
    });
  });

  describe("when the workflow's own code raised", () => {
    /** @scenario "A run whose workflow code raised logs the error type but not its message" */
    it("logs the error type and leaves the message out", async () => {
      const body = JSON.stringify({
        errorType: "ValueError",
        errorMessage: "bad input: sk-live-secret",
      });

      await expect(executeAnswering(failedWith(body))).rejects.toMatchObject({
        code: "workflow_execution_failed",
      });

      const line = errorLine();
      expect(line).toMatchObject({ status: 502, errorType: "ValueError" });
      expect(line).not.toHaveProperty("errorMessage");
      expect(JSON.stringify(captured.lines)).not.toContain("sk-live-secret");
    });
  });

  describe("when the failed answer is not a function error payload", () => {
    /** @scenario "A run the engine's function raised on names the cause in the log" */
    it("logs the status alone", async () => {
      await expect(executeAnswering(failedWith("<html>bad gateway</html>"))).rejects.toMatchObject({
        code: "workflow_execution_failed",
      });

      const line = errorLine();
      expect(line).toMatchObject({ status: 502 });
      expect(line).not.toHaveProperty("errorType");
      expect(line).not.toHaveProperty("errorMessage");
    });
  });
});
