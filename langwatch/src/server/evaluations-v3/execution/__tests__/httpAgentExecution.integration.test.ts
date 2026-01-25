/**
 * Integration tests for HTTP agent execution against langwatch_nlp.
 *
 * These tests verify that:
 * 1. HTTP nodes are properly recognized by the Python parser
 * 2. HTTP nodes execute correctly (make requests, interpolate, extract)
 *
 * Requires:
 * - LANGWATCH_NLP_SERVICE running on localhost:5561
 * - Database available for test project
 */
import type { Project } from "@prisma/client";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";
import { studioBackendPostEvent } from "~/app/api/workflows/post_event/post-event";
import type { TargetConfig, HttpConfig } from "~/evaluations-v3/types";
import { addEnvs } from "~/optimization_studio/server/addEnvs";
import { loadDatasets } from "~/optimization_studio/server/loadDatasets";
import type { StudioServerEvent } from "~/optimization_studio/types/events";
import type { ServerWorkflow, HttpComponentConfig, Field } from "~/optimization_studio/types/dsl";
import { getTestProject } from "~/utils/testUtils";
import { buildCellWorkflow } from "../workflowBuilder";
import type { ExecutionCell } from "../types";

/**
 * Bug 4: HTTP agent execution fails with "Code node has no source content"
 *
 * Root cause: TypeScript DSL adapter creates HTTP nodes with this structure:
 *   { type: "http", data: { url, method, bodyTemplate, ... } }
 *
 * But Python expects this structure:
 *   { type: "http", data: { http_config: { url, method, body_template, ... } } }
 *
 * The mismatch causes Python parser to not recognize the HTTP node,
 * and it falls through to the code node case which fails.
 */

describe.skipIf(process.env.CI)("HTTP Agent Execution Integration", () => {
  let project: Project;

  beforeAll(async () => {
    const nlpServiceUrl = process.env.LANGWATCH_NLP_SERVICE;
    if (!nlpServiceUrl) {
      console.warn("LANGWATCH_NLP_SERVICE not set, tests may fail");
    }

    project = await getTestProject("http-agent-execution");
  });

  // Helper to create HTTP agent target config
  const createHttpAgentTarget = (
    httpConfig: HttpConfig,
    overrides?: Partial<TargetConfig>
  ): TargetConfig => ({
    id: "http-target-1",
    type: "agent",
    name: "Test HTTP Agent",
    agentType: "http",
    httpConfig,
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
    mappings: {
      "dataset-1": {
        input: {
          type: "source",
          source: "dataset",
          sourceId: "dataset-1",
          sourceField: "question",
        },
      },
    },
    ...overrides,
  });

  const createCell = (
    targetConfig: TargetConfig,
    datasetEntry: Record<string, unknown>
  ): ExecutionCell => ({
    rowIndex: 0,
    targetId: targetConfig.id,
    targetConfig,
    evaluatorConfigs: [],
    datasetEntry: {
      _datasetId: "dataset-1",
      ...datasetEntry,
    },
  });

  /**
   * Creates a mock TypedAgent for HTTP targets.
   */
  const createMockHttpAgent = (httpConfig: HttpConfig): import("~/server/agents/agent.repository").TypedAgent => ({
    id: "mock-agent-1",
    projectId: project?.id ?? "test-project",
    name: "Mock HTTP Agent",
    type: "http",
    config: {
      name: "HTTP",
      description: "HTTP API endpoint",
      url: httpConfig.url,
      method: httpConfig.method,
      bodyTemplate: httpConfig.bodyTemplate,
      outputPath: httpConfig.outputPath,
      headers: httpConfig.headers,
      auth: httpConfig.auth,
    } as HttpComponentConfig,
    workflowId: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  /**
   * Executes a workflow through the NLP backend.
   */
  const executeWorkflow = async (
    cell: ExecutionCell,
    datasetColumns: Array<{ id: string; name: string; type: string }>,
    httpConfig?: HttpConfig
  ): Promise<StudioServerEvent[]> => {
    const events: StudioServerEvent[] = [];

    // Build loadedData with mock agent if httpConfig provided
    const loadedData = httpConfig
      ? { agent: createMockHttpAgent(httpConfig) }
      : {};

    const { workflow, targetNodeId } = buildCellWorkflow(
      {
        projectId: project.id,
        cell,
        datasetColumns,
      },
      loadedData
    );

    // Build inputs based on target's declared inputs and their mappings
    const inputs: Record<string, unknown> = {};
    const datasetId = cell.datasetEntry._datasetId as string | undefined;
    const targetMappings = datasetId
      ? (cell.targetConfig.mappings[datasetId] ?? {})
      : {};

    for (const input of cell.targetConfig.inputs ?? []) {
      const mapping = targetMappings[input.identifier];
      if (!mapping) continue;

      if (mapping.type === "source" && mapping.source === "dataset") {
        // Get value from dataset entry using the mapped sourceField
        const value =
          cell.datasetEntry[mapping.sourceField] ??
          cell.datasetEntry[mapping.sourceId ?? ""];
        if (value !== undefined) {
          inputs[input.identifier] = value;
        }
      } else if (mapping.type === "value") {
        // Use the literal value from the mapping
        inputs[input.identifier] = mapping.value;
      }
    }

    const rawEvent = {
      type: "execute_component" as const,
      payload: {
        trace_id: `trace_${nanoid()}`,
        workflow: {
          ...workflow,
          state: { execution: { status: "idle" as const } },
        },
        node_id: targetNodeId,
        inputs,
      },
    };

    const enrichedEvent = await loadDatasets(
      await addEnvs(rawEvent, project.id),
      project.id
    );

    await studioBackendPostEvent({
      projectId: project.id,
      message: enrichedEvent,
      onEvent: (serverEvent) => {
        events.push(serverEvent);
      },
    });

    return events;
  };

  describe("Bug 4: HTTP node recognition", () => {
    it("Python parser should recognize HTTP node type (not fall through to code)", async () => {
      // Create an HTTP agent target
      const httpConfig: HttpConfig = {
        url: "https://httpbin.org/post", // Public test endpoint
        method: "POST",
        bodyTemplate: '{"input": "{{input}}"}',
        outputPath: "$.json.input",
      };

      const target = createHttpAgentTarget(httpConfig);
      const cell = createCell(target, { question: "Hello" });

      const events = await executeWorkflow(
        cell,
        [{ id: "question", name: "question", type: "string" }],
        httpConfig
      );

      // BUG: Currently this fails with "Code node has no source content for component Httpagent"
      // The error indicates the Python parser is routing HTTP nodes to the code case

      // Find any error events
      const errorEvent = events.find(
        (e) =>
          (e.type === "component_state_change" &&
            "payload" in e &&
            e.payload.execution_state?.status === "error") ||
          e.type === "error"
      );

      // When the bug is fixed, there should be no error about "Code node has no source content"
      if (errorEvent && "payload" in errorEvent && errorEvent.payload) {
        const errorMessage =
          errorEvent.type === "error"
            ? (errorEvent.payload as { error?: string }).error
            : (errorEvent.payload as { execution_state?: { error?: string } })
                .execution_state?.error;

        // This assertion documents the current bug
        // It should NOT contain this error message once fixed
        expect(errorMessage).not.toContain("Code node has no source content");
      }

      // Should have received a success event for the HTTP node
      const successEvent = events.find(
        (e): e is Extract<StudioServerEvent, { type: "component_state_change" }> =>
          e.type === "component_state_change" &&
          e.payload.component_id === "http-target-1" &&
          e.payload.execution_state?.status === "success"
      );

      expect(successEvent).toBeDefined();
    }, 60000);

    it("HTTP node should make request and extract output", async () => {
      const httpConfig: HttpConfig = {
        url: "https://httpbin.org/post",
        method: "POST",
        bodyTemplate: '{"message": "{{input}}"}',
        outputPath: "$.json.message", // Extract the echoed message
      };

      const target = createHttpAgentTarget(httpConfig);
      const cell = createCell(target, { question: "Test message" });

      const events = await executeWorkflow(
        cell,
        [{ id: "question", name: "question", type: "string" }],
        httpConfig
      );

      const successEvent = events.find(
        (e): e is Extract<StudioServerEvent, { type: "component_state_change" }> =>
          e.type === "component_state_change" &&
          e.payload.component_id === "http-target-1" &&
          e.payload.execution_state?.status === "success"
      );

      expect(successEvent).toBeDefined();
      expect(successEvent?.payload.execution_state?.outputs?.output).toBe(
        "Test message"
      );
    }, 60000);
  });

  describe("HTTP node body template interpolation", () => {
    it("interpolates multiple variables into body template", async () => {
      const httpConfig: HttpConfig = {
        url: "https://httpbin.org/post",
        method: "POST",
        bodyTemplate:
          '{"thread_id": "{{thread_id}}", "message": "{{input}}", "context": "{{context}}"}',
        outputPath: "$.json",
      };

      const target = createHttpAgentTarget(httpConfig, {
        inputs: [
          { identifier: "thread_id", type: "str" },
          { identifier: "input", type: "str" },
          { identifier: "context", type: "str" },
        ],
        mappings: {
          "dataset-1": {
            thread_id: { type: "value", value: "thread-abc-123" },
            input: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "question",
            },
            context: { type: "value", value: "User is testing" },
          },
        },
      });

      const cell = createCell(target, { question: "Hello world" });

      const events = await executeWorkflow(
        cell,
        [{ id: "question", name: "question", type: "string" }],
        httpConfig
      );

      const successEvent = events.find(
        (e): e is Extract<StudioServerEvent, { type: "component_state_change" }> =>
          e.type === "component_state_change" &&
          e.payload.component_id === "http-target-1" &&
          e.payload.execution_state?.status === "success"
      );

      expect(successEvent).toBeDefined();

      const output = successEvent?.payload.execution_state?.outputs?.output;
      expect(output).toMatchObject({
        thread_id: "thread-abc-123",
        message: "Hello world",
        context: "User is testing",
      });
    }, 60000);
  });

  describe("HTTP node JSONPath extraction", () => {
    it("extracts nested value using JSONPath", async () => {
      const httpConfig: HttpConfig = {
        url: "https://httpbin.org/post",
        method: "POST",
        bodyTemplate: '{"data": {"nested": {"value": "{{input}}"}}}',
        outputPath: "$.json.data.nested.value",
      };

      const target = createHttpAgentTarget(httpConfig);
      const cell = createCell(target, { question: "deep value" });

      const events = await executeWorkflow(
        cell,
        [{ id: "question", name: "question", type: "string" }],
        httpConfig
      );

      const successEvent = events.find(
        (e): e is Extract<StudioServerEvent, { type: "component_state_change" }> =>
          e.type === "component_state_change" &&
          e.payload.component_id === "http-target-1" &&
          e.payload.execution_state?.status === "success"
      );

      expect(successEvent).toBeDefined();
      expect(successEvent?.payload.execution_state?.outputs?.output).toBe(
        "deep value"
      );
    }, 60000);
  });

  describe("HTTP node authentication", () => {
    it("includes bearer token in Authorization header", async () => {
      const httpConfig: HttpConfig = {
        url: "https://httpbin.org/post",
        method: "POST",
        bodyTemplate: "{}",
        outputPath: "$.headers.Authorization",
        auth: {
          type: "bearer",
          token: "test-bearer-token",
        },
      };

      const target = createHttpAgentTarget(httpConfig);
      const cell = createCell(target, { question: "test" });

      const events = await executeWorkflow(
        cell,
        [{ id: "question", name: "question", type: "string" }],
        httpConfig
      );

      const successEvent = events.find(
        (e): e is Extract<StudioServerEvent, { type: "component_state_change" }> =>
          e.type === "component_state_change" &&
          e.payload.component_id === "http-target-1" &&
          e.payload.execution_state?.status === "success"
      );

      expect(successEvent).toBeDefined();
      expect(successEvent?.payload.execution_state?.outputs?.output).toBe(
        "Bearer test-bearer-token"
      );
    }, 60000);

    it("includes API key in custom header", async () => {
      const httpConfig: HttpConfig = {
        url: "https://httpbin.org/post",
        method: "POST",
        bodyTemplate: "{}",
        outputPath: "$.headers.X-Api-Key",
        auth: {
          type: "api_key",
          header: "X-Api-Key",
          value: "my-secret-api-key",
        },
      };

      const target = createHttpAgentTarget(httpConfig);
      const cell = createCell(target, { question: "test" });

      const events = await executeWorkflow(
        cell,
        [{ id: "question", name: "question", type: "string" }],
        httpConfig
      );

      const successEvent = events.find(
        (e): e is Extract<StudioServerEvent, { type: "component_state_change" }> =>
          e.type === "component_state_change" &&
          e.payload.component_id === "http-target-1" &&
          e.payload.execution_state?.status === "success"
      );

      expect(successEvent).toBeDefined();
      expect(successEvent?.payload.execution_state?.outputs?.output).toBe(
        "my-secret-api-key"
      );
    }, 60000);
  });

  describe("HTTP node chat_messages interpolation", () => {
    it("interpolates chat_messages array into body template without escaping", async () => {
      // This test reproduces the bug where messages come through empty
      // Template: {"messages": {{messages}}, "model": "gpt-5-nano"}
      // Expected: messages array is JSON stringified and placed directly
      const httpConfig: HttpConfig = {
        url: "https://httpbin.org/post",
        method: "POST",
        bodyTemplate: '{"messages": {{messages}}, "model": "test-model"}',
        outputPath: "$.json",
      };

      const target = createHttpAgentTarget(httpConfig, {
        inputs: [
          { identifier: "messages", type: "chat_messages" as "str" }, // chat_messages type
        ],
        mappings: {
          "dataset-1": {
            messages: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "messages",
            },
          },
        },
      });

      // The dataset entry contains a chat_messages column with JSON array
      const cell = createCell(target, {
        messages: [{ role: "user", content: "hi" }],
      });

      const events = await executeWorkflow(
        cell,
        [{ id: "messages", name: "messages", type: "chat_messages" }],
        httpConfig
      );

      // Find error or success event
      const errorEvent = events.find(
        (e): e is Extract<StudioServerEvent, { type: "component_state_change" }> =>
          e.type === "component_state_change" &&
          e.payload.component_id === "http-target-1" &&
          e.payload.execution_state?.status === "error"
      );

      const successEvent = events.find(
        (e): e is Extract<StudioServerEvent, { type: "component_state_change" }> =>
          e.type === "component_state_change" &&
          e.payload.component_id === "http-target-1" &&
          e.payload.execution_state?.status === "success"
      );

      // Should NOT have "Invalid JSON" error (this is the bug)
      if (errorEvent) {
        expect(errorEvent.payload.execution_state?.error).not.toContain(
          "Invalid JSON"
        );
      }

      // Should succeed and have the messages in the output
      expect(successEvent).toBeDefined();
      expect(successEvent?.payload.execution_state?.outputs?.output).toMatchObject({
        messages: [{ role: "user", content: "hi" }],
        model: "test-model",
      });
    }, 60000);

    it("interpolates string with special chars into quoted template position", async () => {
      // Test that strings with quotes/newlines are properly escaped
      const httpConfig: HttpConfig = {
        url: "https://httpbin.org/post",
        method: "POST",
        bodyTemplate: '{"input": "{{input}}"}',
        outputPath: "$.json",
      };

      const target = createHttpAgentTarget(httpConfig, {
        inputs: [{ identifier: "input", type: "str" }],
        mappings: {
          "dataset-1": {
            input: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "input",
            },
          },
        },
      });

      // Input with special chars that need escaping
      const cell = createCell(target, {
        input: 'hello "world"\nline2',
      });

      const events = await executeWorkflow(
        cell,
        [{ id: "input", name: "input", type: "string" }],
        httpConfig
      );

      const successEvent = events.find(
        (e): e is Extract<StudioServerEvent, { type: "component_state_change" }> =>
          e.type === "component_state_change" &&
          e.payload.component_id === "http-target-1" &&
          e.payload.execution_state?.status === "success"
      );

      expect(successEvent).toBeDefined();
      expect(successEvent?.payload.execution_state?.outputs?.output).toMatchObject({
        input: 'hello "world"\nline2',
      });
    }, 60000);
  });

  describe("HTTP node error handling", () => {
    it("returns error for connection failure", async () => {
      const httpConfig: HttpConfig = {
        url: "https://nonexistent-domain-xyz.invalid/api",
        method: "POST",
        bodyTemplate: "{}",
      };

      const target = createHttpAgentTarget(httpConfig);
      const cell = createCell(target, { question: "test" });

      const events = await executeWorkflow(
        cell,
        [{ id: "question", name: "question", type: "string" }],
        httpConfig
      );

      const errorEvent = events.find(
        (e): e is Extract<StudioServerEvent, { type: "component_state_change" }> =>
          e.type === "component_state_change" &&
          e.payload.component_id === "http-target-1" &&
          e.payload.execution_state?.status === "error"
      );

      expect(errorEvent).toBeDefined();
      expect(errorEvent?.payload.execution_state?.error).toBeDefined();
    }, 60000);

    it("returns error for non-2xx response", async () => {
      const httpConfig: HttpConfig = {
        url: "https://httpbin.org/status/401", // Returns 401 Unauthorized
        method: "GET",
      };

      const target = createHttpAgentTarget(httpConfig);
      const cell = createCell(target, { question: "test" });

      const events = await executeWorkflow(
        cell,
        [{ id: "question", name: "question", type: "string" }],
        httpConfig
      );

      const errorEvent = events.find(
        (e): e is Extract<StudioServerEvent, { type: "component_state_change" }> =>
          e.type === "component_state_change" &&
          e.payload.component_id === "http-target-1" &&
          e.payload.execution_state?.status === "error"
      );

      expect(errorEvent).toBeDefined();
      expect(errorEvent?.payload.execution_state?.error).toContain("401");
    }, 60000);
  });
});
