import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentsApiService } from "@/client-sdk/services/agents/agents-api.service";
import { resolveLocalUrl, resolveTargetAgent } from "../dev/resolve";

/**
 * Agent selection for `langwatch agent dev` when `--agent` is omitted.
 *
 * The selection order (flag, remembered agent, lone agent, picker) mostly
 * needs no test double beyond a fake service, but the edges do: with no HTTP
 * agents a terminal session offers to create one on the spot, and a session
 * without a terminal must fail with the exact command that skips the
 * interactivity.
 *
 * @see specs/agents/agent-dev-tunnel.feature
 */

const { mockPrompts } = vi.hoisted(() => ({ mockPrompts: vi.fn() }));
vi.mock("prompts", () => ({ default: mockPrompts }));

// Keep the per-directory memory inert: these tests drive the picker, not the
// remembered-agent shortcut.
vi.mock("../../../utils/governance/config", () => ({
  loadConfig: vi.fn(() => ({})),
  saveConfig: vi.fn(),
}));

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // intentionally empty, suppresses output during tests
};

const makeAgent = (overrides: Record<string, unknown> = {}) => ({
  id: "agent_abc123",
  name: "Bid Companion",
  type: "http",
  config: { url: "https://staging.example.com/agent" },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  platformUrl: "https://app.langwatch.test/proj/agents",
  ...overrides,
});

function makeService({ agents }: { agents: ReturnType<typeof makeAgent>[] }): {
  service: AgentsApiService;
  create: ReturnType<typeof vi.fn>;
} {
  const create = vi
    .fn()
    .mockImplementation((params: { name: string; config: unknown }) =>
      Promise.resolve(makeAgent({ id: "agent_new", name: params.name, config: params.config })),
    );
  const service = {
    list: vi.fn().mockResolvedValue({ data: agents }),
    create,
  } as unknown as AgentsApiService;
  return { service, create };
}

// Vitest recycles worker processes across files, so forcing a value into
// process.stdin.isTTY would leak into whatever file runs next in the same
// worker. Capture the original descriptors once and restore them after each
// test.
const originalTTY = {
  stdin: Object.getOwnPropertyDescriptor(process.stdin, "isTTY"),
  stdout: Object.getOwnPropertyDescriptor(process.stdout, "isTTY"),
};

function setTTY(isTTY: boolean) {
  Object.defineProperty(process.stdin, "isTTY", {
    value: isTTY,
    configurable: true,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    value: isTTY,
    configurable: true,
  });
}

function restoreTTY() {
  for (const [stream, descriptor] of [
    [process.stdin, originalTTY.stdin],
    [process.stdout, originalTTY.stdout],
  ] as const) {
    if (descriptor) {
      Object.defineProperty(stream, "isTTY", descriptor);
    } else {
      delete (stream as { isTTY?: boolean }).isTTY;
    }
  }
}

describe("agent dev target resolution", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockPrompts.mockReset();
    vi.spyOn(console, "log").mockImplementation(noop);
    consoleError = vi.spyOn(console, "error").mockImplementation(noop);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ProcessExitError(code as number);
    });
  });

  afterEach(() => {
    restoreTTY();
    vi.restoreAllMocks();
  });

  describe("given the project has no HTTP agents", () => {
    describe("when the session runs in a terminal", () => {
      /** @scenario "With no HTTP agents, an interactive session creates one on the spot" */
      it("creates the agent it offered and returns it as the target", async () => {
        setTTY(true);
        mockPrompts.mockResolvedValue({ name: "My Local Agent" });
        const { service, create } = makeService({ agents: [] });

        const agent = await resolveTargetAgent({
          service,
          localUrl: "http://localhost:8010/agent/chat",
        });

        expect(create).toHaveBeenCalledWith({
          name: "My Local Agent",
          type: "http",
          config: { url: "http://localhost:8010/agent/chat", method: "POST" },
        });
        expect(agent.id).toBe("agent_new");
        expect(agent.name).toBe("My Local Agent");
        expect(mockPrompts).toHaveBeenCalledWith(
          expect.objectContaining({
            initial: path.basename(process.cwd()) || "my-agent",
          }),
        );
      });

      it("offers my-agent when the directory has no basename", async () => {
        setTTY(true);
        vi.spyOn(process, "cwd").mockReturnValue("/");
        mockPrompts.mockResolvedValue({ name: "my-agent" });
        const { service } = makeService({ agents: [] });

        await resolveTargetAgent({
          service,
          localUrl: "http://localhost:8010/agent/chat",
        });

        expect(mockPrompts).toHaveBeenCalledWith(expect.objectContaining({ initial: "my-agent" }));
      });

      /** @scenario "Declining the offered agent name ends the session with instructions" */
      it("fails with the create command when the name prompt is cancelled", async () => {
        setTTY(true);
        // prompts resolves with an empty object when the user hits Esc.
        mockPrompts.mockResolvedValue({});
        const { service, create } = makeService({ agents: [] });

        await expect(
          resolveTargetAgent({
            service,
            localUrl: "http://localhost:8010/agent/chat",
          }),
        ).rejects.toThrow(ProcessExitError);

        expect(create).not.toHaveBeenCalled();
        expect(String(consoleError.mock.calls.flat())).toContain("langwatch agent create");
      });
    });

    describe("when the session runs without a terminal", () => {
      /** @scenario "With no HTTP agents and no terminal, the session names the create command" */
      it("fails with the create command instead of prompting", async () => {
        setTTY(false);
        const { service, create } = makeService({ agents: [] });

        await expect(
          resolveTargetAgent({
            service,
            localUrl: "http://localhost:8010/agent/chat",
          }),
        ).rejects.toThrow(ProcessExitError);

        expect(mockPrompts).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
        expect(String(consoleError.mock.calls.flat())).toContain("langwatch agent create");
      });
    });
  });

  describe("given the project has several HTTP agents", () => {
    describe("when the session runs without a terminal and no --agent flag", () => {
      /** @scenario "With several HTTP agents and no terminal, the session names the agent flag" */
      it("fails and says to pass --agent", async () => {
        setTTY(false);
        const { service } = makeService({
          agents: [
            makeAgent({ id: "agent_a", name: "A" }),
            makeAgent({ id: "agent_b", name: "B" }),
          ],
        });

        await expect(
          resolveTargetAgent({
            service,
            localUrl: "http://localhost:8010/agent/chat",
          }),
        ).rejects.toThrow(ProcessExitError);

        expect(mockPrompts).not.toHaveBeenCalled();
        expect(String(consoleError.mock.calls.flat())).toContain("--agent <id|name>");
      });
    });
  });

  describe("given a --url value carrying embedded credentials", () => {
    /** @scenario "A local URL carrying credentials is refused" */
    it("fails and says to pass the URL without credentials", () => {
      // The URL lands in the agent's platform config and in terminal
      // output, so userinfo in it would leak both ways.
      expect(() => resolveLocalUrl({ url: "http://user:secret@localhost:3000" })).toThrow(
        ProcessExitError,
      );

      expect(String(consoleError.mock.calls.flat())).toContain("without credentials");
    });
  });

  describe("given the project has exactly one HTTP agent", () => {
    it("picks it without prompting, even without a terminal", async () => {
      setTTY(false);
      const only = makeAgent({ id: "agent_only", name: "Only" });
      const { service } = makeService({ agents: [only] });

      const agent = await resolveTargetAgent({
        service,
        localUrl: "http://localhost:8010/agent/chat",
      });

      expect(agent.id).toBe("agent_only");
      expect(mockPrompts).not.toHaveBeenCalled();
    });
  });
});
