/**
 * The agent tools with a connected agent: the fields the listing and the
 * detail expose, and the relay a run goes through.
 *
 * @see specs/mcp-server/agent-tools.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../langwatch-api.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, makeRequest: vi.fn() };
});
vi.mock("../public-http-request.js", () => ({ requestPublicJson: vi.fn() }));

import { makeRequest } from "../langwatch-api.js";
import { runAgent, type AgentSummary } from "../langwatch-api-agents.js";
import { requestPublicJson } from "../public-http-request.js";
import { runPlanTargetSchema, toWireTargets } from "../schemas/run-plan.js";
import { handleGetAgent } from "../tools/get-agent.js";
import { handleListAgents } from "../tools/list-agents.js";
import { handleRunAgent } from "../tools/run-agent.js";
import { handleTestAgent } from "../tools/test-agent.js";

const mockRequest = vi.mocked(makeRequest);
const mockPublic = vi.mocked(requestPublicJson);

const connectedAgent = (overrides: Partial<AgentSummary> = {}): AgentSummary => ({
  id: "agent_conn",
  name: "support-agent",
  type: "connected",
  config: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  environment: "production",
  status: "online",
  instances: [
    { id: "inst_1", hostname: "pod-a", label: "blue", connectedAt: "2026-01-02T00:00:00Z" },
    { id: "inst_2", hostname: "pod-b", label: null, connectedAt: "2026-01-02T00:01:00Z" },
  ],
  owner: { userId: "u1", name: "Ada" },
  parameters: [
    {
      name: "model",
      type: "string",
      options: ["gpt-5", "gpt-5-mini"],
      default: "gpt-5-mini",
      required: false,
    },
    { name: "plan", type: "string", required: true, description: "Customer plan" },
  ],
  ...overrides,
});

const httpAgent = (): AgentSummary => ({
  id: "agent_http",
  name: "Legacy",
  type: "http",
  config: { url: "https://api.example.com/agent" },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleListAgents()", () => {
  describe("when a connected agent and an HTTP agent are listed", () => {
    /** @scenario "The listing shows environment, status, instances and owner" */
    /** @scenario "The listing keeps the HTTP agent entry unchanged" */
    it("shows the connected fields on the connected entry only", async () => {
      mockRequest.mockResolvedValueOnce({
        data: [connectedAgent(), httpAgent()],
        pagination: { page: 1, limit: 100, total: 2, totalPages: 1 },
      });

      const output = await handleListAgents();

      const [, connected, http] = output.split("## ");
      expect(connected).toContain("**Environment**: production");
      expect(connected).toContain("**Status**: online");
      expect(connected).toContain("**Instances**: 2");
      expect(connected).toContain("**Owner**: Ada");
      expect(http).toContain("**Type**: http");
      expect(http).not.toContain("Environment");
      expect(http).not.toContain("Status");
    });
  });
});

describe("handleGetAgent()", () => {
  describe("when the agent declares parameters and has instances", () => {
    /** @scenario "The detail shows the parameters and the instances" */
    it("lists each parameter with its type, options, default and required, and each instance", async () => {
      mockRequest.mockResolvedValueOnce(connectedAgent());

      const output = await handleGetAgent({ id: "agent_conn" });

      expect(output).toContain("## Parameters");
      expect(output).toContain(
        '- **model** (string, one of gpt-5, gpt-5-mini, default "gpt-5-mini")',
      );
      expect(output).toContain("- **plan** (string, required): Customer plan");
      expect(output).toContain("## Instances (2)");
      expect(output).toContain("- pod-a (blue), connected 2026-01-02T00:00:00Z");
      expect(output).toContain("- pod-b, connected 2026-01-02T00:01:00Z");
      expect(output).toContain("**Owner**: Ada");
    });
  });
});

describe("handleTestAgent()", () => {
  describe("when an agent is tested", () => {
    /** @scenario "The REST route schedules the same run" */
    it("posts to the test route and reports the run ids to follow", async () => {
      mockRequest.mockResolvedValueOnce({
        scenarioRunId: "run_1",
        batchRunId: "batch_1",
        setId: "__internal__proj_1__agent-test",
      });

      const output = await handleTestAgent({ id: "agent_http" });

      expect(mockRequest).toHaveBeenCalledWith("POST", "/api/v1/agents/agent_http/test", {});
      expect(output).toContain("**Scenario run ID:** run_1");
      expect(output).toContain("**Batch run ID:** batch_1");
      expect(output).toContain("platform_get_simulation_run");
    });
  });
});

describe("handleRunAgent()", () => {
  describe("when the agent is connected and online", () => {
    /** @scenario "A message runs one turn on a live instance" */
    it("calls the relay with one user message and the parameters, and reports the instance", async () => {
      mockRequest.mockResolvedValueOnce(connectedAgent());
      mockRequest.mockResolvedValueOnce({
        output: "Sure, I can help.",
        session: { id: "s1" },
        instance: { hostname: "pod-a", label: "blue" },
        durationMs: 321,
      });

      const output = await handleRunAgent({
        id: "agent_conn",
        message: "hi",
        parameters: { model: "gpt-5" },
      });

      expect(mockRequest).toHaveBeenNthCalledWith(2, "POST", "/api/v1/agents/agent_conn/call", {
        messages: [{ role: "user", content: "hi" }],
        params: { model: "gpt-5" },
      });
      expect(output).toContain("type: connected");
      expect(output).toContain("Sure, I can help.");
      expect(output).toContain("**Instance:** pod-a (blue)");
      expect(output).toContain("**Duration:** 321 ms");
    });

    /** @scenario "An input with messages is sent as the relay body" */
    it("sends an input with messages, thread id and session as the body", async () => {
      mockRequest.mockResolvedValueOnce(connectedAgent());
      mockRequest.mockResolvedValueOnce({
        output: "ok",
        instance: { hostname: "pod-a" },
        durationMs: 1,
      });
      const input = JSON.stringify({
        messages: [{ role: "user", content: "again" }],
        threadId: "t1",
        session: { id: "s1" },
      });

      await handleRunAgent({ id: "agent_conn", input, threadId: "t2" });

      expect(mockRequest).toHaveBeenNthCalledWith(2, "POST", "/api/v1/agents/agent_conn/call", {
        messages: [{ role: "user", content: "again" }],
        threadId: "t2",
        session: { id: "s1" },
      });
    });

    /** @scenario "A connected agent needs a conversation" */
    it("refuses an input with no messages and no message", async () => {
      mockRequest.mockResolvedValueOnce(connectedAgent());

      await expect(runAgent({ id: "agent_conn", input: { question: "hi" } })).rejects.toThrow(
        /give `message`, or `input` with a `messages` list/,
      );
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it("refuses an offline agent before the relay is called", async () => {
      mockRequest.mockResolvedValueOnce(connectedAgent({ status: "offline", instances: [] }));

      await expect(runAgent({ id: "agent_conn", message: "hi" })).rejects.toThrow(/is offline/);
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A nested params object is refused before the relay" */
    it("refuses an input whose params carry a nested object", async () => {
      mockRequest.mockResolvedValueOnce(connectedAgent());

      await expect(
        runAgent({
          id: "agent_conn",
          input: {
            messages: [{ role: "user", content: "hi" }],
            params: { model: { name: "gpt-5" } },
          },
        }),
      ).rejects.toThrow(/flat object of string, number or boolean values/);
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the input is JSON that is not an object", () => {
    /** @scenario "An input that is not a JSON object is refused" */
    it("refuses a scalar, an array and null before the agent is read", async () => {
      for (const input of ["5", '"hi"', "[1,2]", "null"]) {
        expect(await handleRunAgent({ id: "agent_conn", input })).toBe(
          "Error: `input` must be a valid JSON object.",
        );
      }
      expect(mockRequest).not.toHaveBeenCalled();
    });
  });

  describe("when the agent is an HTTP agent", () => {
    /** @scenario "An HTTP agent is still called at its URL" */
    it("calls the URL directly and not the relay", async () => {
      mockRequest.mockResolvedValueOnce(httpAgent());
      mockPublic.mockResolvedValueOnce({ answer: "hi" });

      const output = await handleRunAgent({ id: "agent_http", input: '{"question":"hi"}' });

      expect(mockPublic).toHaveBeenCalledWith(
        "https://api.example.com/agent",
        expect.objectContaining({ method: "POST" }),
      );
      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(output).toContain("type: http");
    });
  });
});

describe("runPlanTargetSchema", () => {
  /** @scenario "A connected target names an agent by id" */
  it("accepts a connected target with an agent id", () => {
    expect(runPlanTargetSchema.parse({ type: "connected", referenceId: "agent_conn" })).toEqual({
      type: "connected",
      referenceId: "agent_conn",
    });
  });

  /** @scenario "A connected target names an agent by name and environment" */
  it("passes name@environment through as the reference id", () => {
    const targets = toWireTargets([
      runPlanTargetSchema.parse({
        type: "connected",
        referenceId: "support-agent@production",
        parameters: { model: "gpt-5" },
      }),
    ]);
    expect(targets).toEqual([
      {
        type: "connected",
        referenceId: "support-agent@production",
        runParameters: { model: "gpt-5" },
      },
    ]);
  });
});
