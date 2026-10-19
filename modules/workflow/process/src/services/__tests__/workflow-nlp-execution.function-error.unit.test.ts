/** @see modules/workflow/specs/studio-lambda-stream.feature */
import type { StudioClientEvent } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createLogger: () => logger,
}));

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
  } as unknown as Parameters<typeof WorkflowNlpExecutionService.create>[0]).execute(input);

const failedWith = (body: string): WorkflowNlpDispatchResponse => ({
  ok: false,
  status: 502,
  statusText: "Unhandled",
  json: async () => JSON.parse(body) as unknown,
  text: async () => body,
});

describe("WorkflowNlpExecutionService", () => {
  describe("when the engine's function raised", () => {
    /** @scenario "A run the engine's function raised on names the cause in the log" */
    it("logs the raised error's type and capped message, and nothing else", async () => {
      logger.error.mockClear();
      const body = JSON.stringify({
        errorType: "Runtime.ExitError",
        errorMessage: `RequestId: abc Error: Runtime exited ${"x".repeat(5000)}`,
        trace: ["line one", "line two"],
      });

      await expect(executeAnswering(failedWith(body))).rejects.toThrow();

      const [fields] = logger.error.mock.calls[0] ?? [];
      expect(fields).toMatchObject({
        status: 502,
        statusText: "Unhandled",
        errorType: "Runtime.ExitError",
      });
      expect((fields as { errorMessage: string }).errorMessage).toMatch(/^RequestId: abc Error/);
      expect((fields as { errorMessage: string }).errorMessage.length).toBe(1000);
      expect(fields).not.toHaveProperty("trace");
    });
  });

  describe("when the failed answer is not a function error payload", () => {
    /** @scenario "A run the engine's function raised on names the cause in the log" */
    it("logs the status alone", async () => {
      logger.error.mockClear();

      await expect(executeAnswering(failedWith("<html>bad gateway</html>"))).rejects.toThrow();

      const [fields] = logger.error.mock.calls[0] ?? [];
      expect(fields).toMatchObject({ status: 502 });
      expect(fields).not.toHaveProperty("errorType");
      expect(fields).not.toHaveProperty("errorMessage");
    });
  });
});
