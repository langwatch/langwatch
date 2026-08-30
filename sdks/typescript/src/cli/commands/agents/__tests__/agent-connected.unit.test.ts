/**
 * The agent commands with a connected agent: the columns the list shows, the
 * parameters and instances the detail shows, and the relay a run goes
 * through.
 *
 * @see specs/typescript-sdk/cli-agents.feature
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/client-sdk/services/agents/agents-api.service", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    AgentsApiService: vi.fn(),
  };
});

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({ apiKey: "test-key", source: "env", endpoint: "https://app.langwatch.ai" })),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

import {
  AgentsApiService,
  type AgentResponse,
} from "@/client-sdk/services/agents/agents-api.service";
import { describeParameter, getAgentCommand } from "../get";
import { agentOwnerLabel, agentStatusLabel, listAgentsCommand } from "../list";
import { buildRelayBody, runAgentCommand } from "../run";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // Suppresses output during tests.
};

const connectedAgent = (overrides: Partial<AgentResponse> = {}): AgentResponse => ({
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
  owner: null,
  hostLabel: null,
  parameters: [
    { name: "model", type: "string", options: ["gpt-5", "gpt-5-mini"], default: "gpt-5-mini", required: false },
    { name: "plan", type: "string", required: true, description: "Customer plan" },
  ],
  ...overrides,
});

const httpAgent = (): AgentResponse => ({
  id: "agent_http",
  name: "Legacy",
  type: "http",
  config: { url: "https://api.example.com/agent" },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
});

let service: { list: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; call: ReturnType<typeof vi.fn> };
let printed: () => string;

beforeEach(() => {
  vi.clearAllMocks();
  service = { list: vi.fn(), get: vi.fn(), call: vi.fn() };
  vi.mocked(AgentsApiService).mockImplementation(function () {
    return service as unknown as AgentsApiService;
  });
  const log = vi.spyOn(console, "log").mockImplementation(noop);
  vi.spyOn(console, "error").mockImplementation(noop);
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });
  printed = () => log.mock.calls.flat().join("\n");
});

describe("listAgentsCommand()", () => {
  describe("when a connected agent and an HTTP agent are listed", () => {
    /** @scenario "The list prints Name, Environment, Status, Type, ID, Owner and Updated" */
    it("prints the seven columns, online for the connected one and blanks for the HTTP one", async () => {
      service.list.mockResolvedValue({
        data: [connectedAgent(), httpAgent()],
        pagination: { page: 1, limit: 100, total: 2, totalPages: 1 },
      });

      const result = await listAgentsCommand();
      result?.table?.();

      const output = printed();
      for (const header of ["Name", "Environment", "Status", "Type", "ID", "Owner", "Updated"]) {
        expect(output).toContain(header);
      }
      expect(output).toContain("production");
      expect(output).toContain("online");
      expect(agentStatusLabel(httpAgent())).toBe("");
      expect(agentOwnerLabel(httpAgent())).toBe("");
    });

    /** @scenario "The owner column reads the owner of a personal agent or the host of a machine-scoped one" */
    it("reads the owner name, else the host label", () => {
      expect(agentOwnerLabel(connectedAgent({ owner: { userId: "u1", name: "Ada" } }))).toBe("Ada");
      expect(agentOwnerLabel(connectedAgent({ hostLabel: "ada-laptop" }))).toBe("ada-laptop");
      expect(agentOwnerLabel(connectedAgent())).toBe("");
    });
  });
});

describe("getAgentCommand()", () => {
  describe("when the agent declares parameters and has instances", () => {
    /** @scenario "The detail lists parameters with type, options, default and required" */
    /** @scenario "The detail lists the connected instances" */
    it("prints the parameters block and the instances block", async () => {
      service.get.mockResolvedValue(connectedAgent());

      const result = await getAgentCommand("agent_conn");
      result?.table?.();

      const output = printed();
      expect(output).toContain("Parameters:");
      expect(output).toContain('model: string, one of gpt-5, gpt-5-mini, default "gpt-5-mini"');
      expect(output).toContain("plan: string, required");
      expect(output).toContain("Instances (2):");
      expect(output).toContain("pod-a (blue) since");
      expect(output).toContain("pod-b since");
      expect(output).toContain("production");
      expect(output).toContain("online");
    });

    it("describes one parameter on one line", () => {
      expect(describeParameter({ name: "n", type: "number", default: 5 })).toBe("n: number, default 5");
    });
  });
});

describe("runAgentCommand()", () => {
  describe("when the agent is connected and online", () => {
    /** @scenario "A message runs one turn on a live instance" */
    it("calls the relay with one user message and the parameters, and prints the reply", async () => {
      service.get.mockResolvedValue(connectedAgent());
      service.call.mockResolvedValue({
        output: "Sure, I can help.",
        session: { id: "s1" },
        instance: { hostname: "pod-a", label: "blue" },
        durationMs: 321,
      });

      const result = await runAgentCommand("agent_conn", { message: "hi", param: ["model=gpt-5"] });
      result?.table?.();

      expect(service.call).toHaveBeenCalledWith("agent_conn", {
        messages: [{ role: "user", content: "hi" }],
        params: { model: "gpt-5" },
      });
      expect(result?.data).toMatchObject({ output: "Sure, I can help." });
      expect(printed()).toContain("Sure, I can help.");
    });

    /** @scenario "An input body with messages is sent as the relay body" */
    it("sends an input with messages, thread id and session as the body", async () => {
      service.get.mockResolvedValue(connectedAgent());
      service.call.mockResolvedValue({ output: "ok", instance: { hostname: "pod-a" }, durationMs: 1 });
      const input = JSON.stringify({
        messages: [{ role: "user", content: "again" }],
        threadId: "t1",
        session: { id: "s1" },
        params: { plan: "pro" },
      });

      await runAgentCommand("agent_conn", { input });

      expect(service.call).toHaveBeenCalledWith("agent_conn", {
        messages: [{ role: "user", content: "again" }],
        threadId: "t1",
        session: { id: "s1" },
        params: { plan: "pro" },
      });
    });

    /** @scenario "A connected agent needs a conversation" */
    it("refuses an input with no messages and no message", async () => {
      service.get.mockResolvedValue(connectedAgent());

      await expect(runAgentCommand("agent_conn", { input: '{"question":"hi"}' })).rejects.toThrow(ProcessExitError);

      expect(service.call).not.toHaveBeenCalled();
      const errors = vi.mocked(console.error).mock.calls.flat().join("\n");
      expect(errors).toMatch(/give --message <text>, or --input with a messages list/);
      expect(buildRelayBody({ input: {}, options: {} })).toMatch(/--message/);
    });
  });

  describe("when the agent is connected and offline", () => {
    /** @scenario "An offline connected agent is refused before the relay is called" */
    it("says the agent is offline and names connectAgent", async () => {
      service.get.mockResolvedValue(connectedAgent({ status: "offline", instances: [] }));

      await expect(runAgentCommand("agent_conn", { message: "hi" })).rejects.toThrow(ProcessExitError);

      expect(service.call).not.toHaveBeenCalled();
      const errors = vi.mocked(console.error).mock.calls.flat().join("\n");
      expect(errors).toMatch(/is offline.*connectAgent/);
    });
  });

  describe("when the agent is an HTTP agent", () => {
    /** @scenario "An HTTP agent is still called at its URL" */
    it("calls the URL directly and not the relay", async () => {
      service.get.mockResolvedValue(httpAgent());
      const fetchMock = vi.fn(async () => ({ status: 200, json: async () => ({ answer: "hi" }) }));
      vi.stubGlobal("fetch", fetchMock);
      try {
        const result = await runAgentCommand("agent_http", { input: '{"question":"hi"}' });
        expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/agent", expect.objectContaining({ method: "POST" }));
        expect(service.call).not.toHaveBeenCalled();
        expect(result?.data).toEqual({ answer: "hi" });
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});

describe("the agent command help", () => {
  const program = readFileSync(join(__dirname, "../../../program.ts"), "utf8");

  /** @scenario "The dev command help points code agents to connectAgent" */
  it("says agent dev is for HTTP agents and names connectAgent and connect_agent", () => {
    const devHelp = program.slice(program.indexOf('.command("dev")'), program.indexOf('.option("--port <number>"'));
    expect(devHelp).toContain("For HTTP agents");
    expect(devHelp).toContain("connectAgent");
    expect(devHelp).toContain("connect_agent");
  });

  /** @scenario "The target help names the connected forms" */
  it("names connected:<id> and connected:<name>@<environment> in the target help", () => {
    const targetHelp = program.slice(program.indexOf("const TARGET_FLAG_HELP"), program.indexOf("const RUN_NAME_FLAG_HELP"));
    expect(targetHelp).toContain("connected:agent_abc123");
    expect(targetHelp).toContain("connected:<name>@<environment>");
  });
});
