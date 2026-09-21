import { EventEmitter } from "node:events";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// The tunnel path verifies the binary it is about to run on every start, and
// the mock below points at the node executable. Verification fails closed on
// an unlisted platform, so the tests pin platform and arch to darwin-x64, a
// named UNVERIFIED_PLATFORMS exception, and verification skips
// deterministically on any host. These tests exercise the session flow
// rather than the checksum.
const realPlatform = process.platform;
const realArch = process.arch;
beforeAll(() => {
  Object.defineProperty(process, "platform", {
    value: "darwin",
    configurable: true,
  });
  Object.defineProperty(process, "arch", {
    value: "x64",
    configurable: true,
  });
});
afterAll(() => {
  Object.defineProperty(process, "platform", {
    value: realPlatform,
    configurable: true,
  });
  Object.defineProperty(process, "arch", {
    value: realArch,
    configurable: true,
  });
});

vi.mock("@/client-sdk/services/agents/agents-api.service", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    AgentsApiService: vi.fn(),
  };
});

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({
    apiKey: "test-key",
    source: "env",
    endpoint: "https://app.langwatch.ai",
  })),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

const fakeTunnels: EventEmitter[] = [];
const quickMock = vi.hoisted(() => vi.fn());
vi.mock("cloudflared", () => ({
  // Points at a path that exists so the session never tries to download.
  bin: process.execPath,
  install: vi.fn(),
  Tunnel: { quick: quickMock },
}));

import { AgentsApiService } from "@/client-sdk/services/agents/agents-api.service";
import { agentTunnelCommand, startAgentTunnelSession } from "../tunnel";
import { DEV_SECRET_HEADER } from "../tunnel/write-back";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // intentionally empty, suppresses output during tests
};

const TUNNEL_URL = "https://lively-otter.trycloudflare.com";

const makeAgent = (overrides: Record<string, unknown> = {}) => ({
  id: "agent_abc123",
  name: "Bid Companion",
  type: "http",
  config: { url: "https://staging.example.com/agent", headers: [] },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  platformUrl:
    "https://app.langwatch.ai/my-project/agents?drawer.open=agentHttpEditor&drawer.agentId=agent_abc123",
  ...overrides,
});

describe("agent tunnel session", () => {
  // Typed as async on purpose: the bare `ReturnType<typeof vi.fn>` declares a
  // void return, so an implementation that returns a promise reads as a
  // misused promise.
  let mockGet: Mock<() => Promise<unknown>>;
  let mockList: ReturnType<typeof vi.fn>;
  let mockUpdate: ReturnType<typeof vi.fn>;

  const startFakeTunnelOnQuick = () => {
    quickMock.mockImplementation(() => {
      const tunnel = new EventEmitter() as EventEmitter & {
        stop: () => boolean;
      };
      tunnel.stop = vi.fn(() => true);
      fakeTunnels.push(tunnel);
      setImmediate(() => tunnel.emit("url", TUNNEL_URL));
      return tunnel;
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fakeTunnels.length = 0;
    // Keep the remembered-agent write away from the developer's real
    // ~/.langwatch/config.json.
    process.env.LANGWATCH_CLI_CONFIG = path.join(
      os.tmpdir(),
      `lw-agent-tunnel-test-${process.pid}-${Math.random().toString(36).slice(2)}.json`,
    );

    mockGet = vi.fn().mockResolvedValue(makeAgent());
    mockList = vi.fn().mockResolvedValue({
      data: [makeAgent()],
      pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
    });
    mockUpdate = vi.fn().mockImplementation((_id, params) =>
      Promise.resolve(makeAgent({ config: params.config })),
    );
    vi.mocked(AgentsApiService).mockImplementation(function () {
      return {
        list: mockList,
        get: mockGet,
        create: vi.fn(),
        update: mockUpdate,
        delete: vi.fn(),
      } as unknown as AgentsApiService;
    });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ProcessExitError(code as number);
    });
    startFakeTunnelOnQuick();
  });

  afterEach(() => {
    delete process.env.LANGWATCH_CLI_CONFIG;
    // The health-check tests spy on globalThis.fetch; clearAllMocks would
    // leave the spy installed for every test that follows.
    vi.restoreAllMocks();
  });

  describe("when the session starts against a local port", () => {
    /** @scenario "URL write-back replaces the agent URL and stashes the previous one" */
    it("PATCHes the agent with the tunnel URL, the stash, and the secret header", async () => {
      const session = await startAgentTunnelSession({
        port: "8000",
        agent: "agent_abc123",
      });

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      const [id, params] = mockUpdate.mock.calls[0] as [
        string,
        { config: Record<string, unknown> },
      ];
      expect(id).toBe("agent_abc123");
      expect(params.config.url).toBe(`${TUNNEL_URL}/agent`);
      expect(params.config.devTunnel).toMatchObject({
        previousUrl: "https://staging.example.com/agent",
      });
      const headers = params.config.headers as { key: string; value: string }[];
      const secretRow = headers.find((h) => h.key === DEV_SECRET_HEADER);
      expect(secretRow?.value).toMatch(/^[A-Za-z0-9_-]{32}$/);

      await session.shutdown(0);
    });

    /** @scenario "Ending the session restores the agent and clears the tunnel marker" */
    it("restores the previous URL and clears the stash on shutdown, once", async () => {
      const session = await startAgentTunnelSession({
        port: "8000",
        agent: "agent_abc123",
      });

      const written = (
        mockUpdate.mock.calls[0] as [string, { config: Record<string, unknown> }]
      )[1].config;
      mockGet.mockResolvedValue(makeAgent({ config: written }));

      await session.shutdown(0);

      expect(mockUpdate).toHaveBeenCalledTimes(2);
      const restored = (
        mockUpdate.mock.calls[1] as [string, { config: Record<string, unknown> }]
      )[1].config;
      expect(restored.url).toBe("https://staging.example.com/agent");
      expect(restored.devTunnel).toBeUndefined();
      expect(
        (restored.headers as { key: string }[]).find(
          (h) => h.key === DEV_SECRET_HEADER,
        ),
      ).toBeUndefined();

      // A second shutdown does not PATCH again.
      await session.shutdown(0);
      expect(mockUpdate).toHaveBeenCalledTimes(2);
      await expect(session.done).resolves.toBe(0);
    });

    it("reports the manual fix when the restore PATCH fails, without throwing", async () => {
      const session = await startAgentTunnelSession({
        port: "8000",
        agent: "agent_abc123",
      });
      mockGet.mockRejectedValue(new Error("network down"));

      await session.shutdown(0);

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("https://staging.example.com/agent"),
      );
      // The advice points at the UI, which edits the URL field alone. It
      // must never name `agent update --config`: that command replaces the
      // whole config, so a url-only payload would wipe headers and auth.
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("LangWatch UI"),
      );
      expect(console.error).not.toHaveBeenCalledWith(
        expect.stringContaining("--config"),
      );
      await expect(session.done).resolves.toBe(0);
    });
  });

  describe("when the platform has no pinned cloudflared digest", () => {
    it("refuses to start rather than running an unverified binary", async () => {
      Object.defineProperty(process, "platform", {
        value: "freebsd",
        configurable: true,
      });
      try {
        await expect(
          startAgentTunnelSession({ port: "8000", agent: "agent_abc123" }),
        ).rejects.toThrow(ProcessExitError);
        expect(mockUpdate).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(process, "platform", {
          value: "darwin",
          configurable: true,
        });
      }
    });
  });

  describe("when --no-update-url is passed", () => {
    /** @scenario "Opting out of the URL update touches nothing" */
    it("never PATCHes the agent, on start or on shutdown", async () => {
      const session = await startAgentTunnelSession({
        port: "8000",
        agent: "agent_abc123",
        updateUrl: false,
      });

      expect(mockUpdate).not.toHaveBeenCalled();

      await session.shutdown(0);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe("when --tunnel-url is passed", () => {
    /** @scenario "Bringing your own tunnel URL skips tunnel provisioning" */
    it("provisions no tunnel and points the agent at the supplied URL", async () => {
      const session = await startAgentTunnelSession({
        port: "8000",
        agent: "agent_abc123",
        tunnelUrl: "https://my-own-tunnel.example.com",
      });

      expect(quickMock).not.toHaveBeenCalled();
      const written = (
        mockUpdate.mock.calls[0] as [string, { config: Record<string, unknown> }]
      )[1].config;
      expect(written.url).toBe("https://my-own-tunnel.example.com/agent");
      // The auth proxy sits outside a bring-your-own tunnel's chain, so no
      // session secret header is written either.
      expect(
        (written.headers as { key: string }[]).find(
          (h) => h.key === DEV_SECRET_HEADER,
        ),
      ).toBeUndefined();

      await session.shutdown(0);
    });

    it("rejects a tunnel URL that does not parse", async () => {
      await expect(
        startAgentTunnelSession({
          port: "8000",
          agent: "agent_abc123",
          tunnelUrl: "not a url",
        }),
      ).rejects.toThrow(ProcessExitError);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe("when --port and --url are both passed", () => {
    it("fails validation before touching the API", async () => {
      await expect(
        startAgentTunnelSession({
          port: "8000",
          url: "http://localhost:8000",
          agent: "agent_abc123",
        }),
      ).rejects.toThrow(ProcessExitError);
      expect(mockList).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe("when neither --port nor --url is passed", () => {
    it("fails with guidance instead of guessing a port", async () => {
      await expect(
        startAgentTunnelSession({ agent: "agent_abc123" }),
      ).rejects.toThrow(ProcessExitError);
    });
  });

  describe("when the --agent flag matches nothing", () => {
    it("fails with guidance to list agents", async () => {
      await expect(
        startAgentTunnelSession({ port: "8000", agent: "no-such-agent" }),
      ).rejects.toThrow(ProcessExitError);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe("when the resolved agent is not an HTTP agent", () => {
    it("refuses to repoint it", async () => {
      mockList.mockResolvedValue({
        data: [makeAgent({ type: "code" })],
        pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
      });

      await expect(
        startAgentTunnelSession({ port: "8000", agent: "agent_abc123" }),
      ).rejects.toThrow(ProcessExitError);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe("when the tunnel process exits behind the session", () => {
    it("restores the agent and resolves the session", async () => {
      const session = await startAgentTunnelSession({
        port: "8000",
        agent: "agent_abc123",
      });
      const written = (
        mockUpdate.mock.calls[0] as [string, { config: Record<string, unknown> }]
      )[1].config;
      mockGet.mockResolvedValue(makeAgent({ config: written }));

      fakeTunnels[0]?.emit("exit", 1, null);

      await expect(session.done).resolves.toBe(0);
      expect(mockUpdate).toHaveBeenCalledTimes(2);
    });
  });

  /**
   * Command-level tests emit real process events, so the test runner's own
   * listeners are detached first and every listener the command registered is
   * swept afterwards; anything the runner held is restored.
   */
  const PROCESS_EVENTS = [
    "SIGINT",
    "SIGTERM",
    "SIGHUP",
    "uncaughtException",
    "unhandledRejection",
  ] as const;

  const withDetachedProcessListeners = async (
    fn: () => Promise<void>,
  ): Promise<void> => {
    const prior = PROCESS_EVENTS.map(
      (event) => [event, process.rawListeners(event)] as const,
    );
    for (const [event] of prior) process.removeAllListeners(event);
    try {
      await fn();
    } finally {
      for (const [event, listeners] of prior) {
        process.removeAllListeners(event);
        for (const listener of listeners) {
          process.on(event, listener as () => void);
        }
      }
    }
  };

  /**
   * Start the command, wait for the write-back, and arm the restore GET.
   * The outcome promise is wrapped in an object: returning it bare would make
   * `await startCommandUntilWriteBack()` flatten into awaiting the command
   * itself, which only ends after the signal this helper's caller sends.
   */
  const startCommandUntilWriteBack = async (): Promise<{
    outcome: Promise<unknown>;
  }> => {
    const outcome = agentTunnelCommand({
      port: "8000",
      agent: "agent_abc123",
    }).catch((error: unknown) => error);

    await vi.waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    const written = (
      mockUpdate.mock.calls[0] as [string, { config: Record<string, unknown> }]
    )[1].config;
    mockGet.mockResolvedValue(makeAgent({ config: written }));
    return { outcome };
  };

  describe("when the dev session ends", () => {
    it("exits with the session's code after shutdown", async () => {
      await withDetachedProcessListeners(async () => {
        const command = await startCommandUntilWriteBack();
        process.emit("SIGINT");

        const outcome = await command.outcome;
        expect(outcome).toBeInstanceOf(ProcessExitError);
        expect((outcome as ProcessExitError).code).toBe(0);
      });
    });
  });

  describe("when the session runs over a caller-supplied tunnel URL", () => {
    /** @scenario "A bring-your-own tunnel session stays up instead of exiting at once" */
    it("keeps the event loop alive until a signal ends the session", async () => {
      await withDetachedProcessListeners(async () => {
        // A caller-supplied tunnel starts neither a tunnel child process nor
        // the local auth proxy, and the health monitor's timer is unref'd, so
        // the command's own keep-alive is all that stands between the banner
        // and an immediate exit that would strand the agent on the tunnel URL.
        // `getActiveResourcesInfo` lists only what keeps the event loop alive,
        // which is exactly that question. Comparing the count across the
        // shutdown, rather than against a count taken before the command
        // started, keeps the test's own timers out of the difference.
        const countRefdTimers = (): number =>
          process
            .getActiveResourcesInfo()
            .filter((resource) => resource === "Timeout").length;

        const outcome = agentTunnelCommand({
          port: "8000",
          agent: "agent_abc123",
          tunnelUrl: "https://my-own-tunnel.example.com",
        }).catch((error: unknown) => error);

        // The write-back is the last await inside the session start, so one
        // macrotask turn past it puts the command's own body on the stack.
        await vi.waitFor(() => expect(mockUpdate).toHaveBeenCalled());
        await new Promise((resolve) => setImmediate(resolve));
        const whileRunning = countRefdTimers();

        const written = (
          mockUpdate.mock.calls[0] as [
            string,
            { config: Record<string, unknown> },
          ]
        )[1].config;
        mockGet.mockResolvedValue(makeAgent({ config: written }));
        process.emit("SIGINT");

        expect(await outcome).toBeInstanceOf(ProcessExitError);
        expect(whileRunning).toBeGreaterThan(countRefdTimers());
        const restored = (
          mockUpdate.mock.calls[1] as [
            string,
            { config: Record<string, unknown> },
          ]
        )[1].config;
        expect(restored.url).toBe("https://staging.example.com/agent");
      });
    });
  });

  describe("when the terminal sends a hangup signal", () => {
    /** @scenario "A hangup signal restores the previous URL like an interrupt" */
    it("restores the agent and exits cleanly", async () => {
      await withDetachedProcessListeners(async () => {
        const command = await startCommandUntilWriteBack();
        process.emit("SIGHUP");

        const outcome = await command.outcome;
        expect(outcome).toBeInstanceOf(ProcessExitError);
        expect((outcome as ProcessExitError).code).toBe(0);
        expect(mockUpdate).toHaveBeenCalledTimes(2);
        const restored = (
          mockUpdate.mock.calls[1] as [
            string,
            { config: Record<string, unknown> },
          ]
        )[1].config;
        expect(restored.url).toBe("https://staging.example.com/agent");
      });
    });
  });

  describe("when an unexpected error crashes the session", () => {
    /** @scenario "A crash inside the session restores best-effort and exits nonzero" */
    it("restores the agent and exits nonzero", async () => {
      await withDetachedProcessListeners(async () => {
        const command = await startCommandUntilWriteBack();
        process.emit("uncaughtException", new Error("boom"));

        const outcome = await command.outcome;
        expect(outcome).toBeInstanceOf(ProcessExitError);
        expect((outcome as ProcessExitError).code).toBe(1);
        expect(mockUpdate).toHaveBeenCalledTimes(2);
        const restored = (
          mockUpdate.mock.calls[1] as [
            string,
            { config: Record<string, unknown> },
          ]
        )[1].config;
        expect(restored.url).toBe("https://staging.example.com/agent");
      });
    });
  });

  describe("when shutdown is called again while the restore is in flight", () => {
    /** @scenario "A second shutdown during restore does not restore twice" */
    it("restores exactly once and both shutdowns finish", async () => {
      const session = await startAgentTunnelSession({
        port: "8000",
        agent: "agent_abc123",
      });
      const written = (
        mockUpdate.mock.calls[0] as [string, { config: Record<string, unknown> }]
      )[1].config;

      let releaseGet!: (agent: unknown) => void;
      mockGet.mockImplementation(
        () =>
          new Promise((resolve) => {
            releaseGet = resolve;
          }),
      );

      const first = session.shutdown(0);
      const second = session.shutdown(0);
      releaseGet(makeAgent({ config: written }));
      await Promise.all([first, second]);

      // One apply, one restore. Never a second restore PATCH.
      expect(mockUpdate).toHaveBeenCalledTimes(2);
      await expect(session.done).resolves.toBe(0);
    });
  });

  describe("when the tunnel reports an error behind the session", () => {
    /** @scenario "A tunnel error ends the session like a tunnel exit" */
    it("restores the agent and resolves the session nonzero", async () => {
      const session = await startAgentTunnelSession({
        port: "8000",
        agent: "agent_abc123",
      });
      const written = (
        mockUpdate.mock.calls[0] as [string, { config: Record<string, unknown> }]
      )[1].config;
      mockGet.mockResolvedValue(makeAgent({ config: written }));

      fakeTunnels[0]?.emit("error", new Error("edge dropped the connection"));

      await expect(session.done).resolves.toBe(1);
      expect(mockUpdate).toHaveBeenCalledTimes(2);
    });
  });

  describe("when health checks fail three times in a row", () => {
    /** @scenario "An unhealthy tunnel is re-provisioned in place" */
    it("provisions a replacement tunnel and re-points the agent", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("edge down"));

      const session = await startAgentTunnelSession(
        { port: "8000", agent: "agent_abc123" },
        { healthIntervalMs: 5 },
      );

      // The probes keep failing after the replacement too, so the monitor may
      // have replaced the tunnel more than once by the time we look.
      await vi.waitFor(() => {
        expect(quickMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      });
      await vi.waitFor(() => {
        expect(mockUpdate.mock.calls.length).toBeGreaterThanOrEqual(2);
      });
      const reapplied = (
        mockUpdate.mock.calls[1] as [string, { config: Record<string, unknown> }]
      )[1].config;
      expect(reapplied.url).toBe(`${TUNNEL_URL}/agent`);
      expect(reapplied.devTunnel).toMatchObject({
        previousUrl: "https://staging.example.com/agent",
      });

      await session.shutdown(0);
    });

    /** @scenario "A probe that never answers does not stop the health monitor" */
    it("keeps probing when a probe only ends on its own timeout", async () => {
      // A half-open socket at the edge never settles the fetch. Without the
      // probe timeout the monitor stops re-arming and the session runs blind.
      vi.spyOn(globalThis, "fetch").mockImplementation(
        ((_input: unknown, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new Error("probe timed out"));
            });
          })) as unknown as typeof fetch,
      );

      const session = await startAgentTunnelSession(
        { port: "8000", agent: "agent_abc123" },
        { healthIntervalMs: 5, healthProbeTimeoutMs: 10 },
      );

      await vi.waitFor(() => {
        expect(quickMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      });

      await session.shutdown(0);
    });

    /** @scenario "A failed re-provision restores the agent and ends the session" */
    it("restores and ends the session when re-provisioning fails", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("edge down"));

      const session = await startAgentTunnelSession(
        { port: "8000", agent: "agent_abc123" },
        { healthIntervalMs: 5 },
      );
      const written = (
        mockUpdate.mock.calls[0] as [string, { config: Record<string, unknown> }]
      )[1].config;
      mockGet.mockResolvedValue(makeAgent({ config: written }));
      quickMock.mockImplementation(() => {
        throw new Error("no more tunnels");
      });

      await expect(session.done).resolves.toBe(1);
      expect(mockUpdate).toHaveBeenCalledTimes(2);
      const restored = (
        mockUpdate.mock.calls[1] as [string, { config: Record<string, unknown> }]
      )[1].config;
      expect(restored.url).toBe("https://staging.example.com/agent");
    });

    /** @scenario "A bring-your-own tunnel only warns when unhealthy" */
    it("only warns for a bring-your-own tunnel, without provisioning", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("edge down"));

      const session = await startAgentTunnelSession(
        {
          port: "8000",
          agent: "agent_abc123",
          tunnelUrl: "https://my-own-tunnel.example.com",
        },
        { healthIntervalMs: 5 },
      );

      await vi.waitFor(() => {
        expect(console.error).toHaveBeenCalledWith(
          expect.stringContaining("stopped answering"),
        );
      });
      expect(quickMock).not.toHaveBeenCalled();
      // The session stays up: only the apply PATCH happened.
      expect(mockUpdate).toHaveBeenCalledTimes(1);

      await session.shutdown(0);
    });
  });

  describe("when health checks find the tunnel healthy", () => {
    /** @scenario "Healthy checks refresh the tunnel heartbeat" */
    it("refreshes devTunnel.heartbeatAt through the agents service", async () => {
      // The auth proxy rejects the unauthenticated probe with 401, which still
      // proves the whole chain is up, so it counts as healthy.
      vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        new Response("unauthorized", { status: 401 }),
      );

      const session = await startAgentTunnelSession(
        { port: "8000", agent: "agent_abc123" },
        { healthIntervalMs: 5 },
      );
      const written = (
        mockUpdate.mock.calls[0] as [string, { config: Record<string, unknown> }]
      )[1].config;
      mockGet.mockResolvedValue(makeAgent({ config: written }));

      await vi.waitFor(() => {
        const heartbeat = mockUpdate.mock.calls
          .slice(1)
          .find(
            ([, params]) =>
              (
                (params as { config: Record<string, unknown> }).config
                  .devTunnel as { heartbeatAt?: string } | undefined
              )?.heartbeatAt !== undefined,
          );
        expect(heartbeat).toBeDefined();
      });
      expect(quickMock).toHaveBeenCalledTimes(1);

      await session.shutdown(0);
    });
  });

  describe("when the agent still carries a stash from a crashed session", () => {
    /** @scenario "A stale stash from a crashed session is restored before a new tunnel" */
    it("restores the original URL first, then applies the fresh tunnel", async () => {
      const stale = makeAgent({
        config: {
          url: "https://dead-session.trycloudflare.com",
          headers: [],
          devTunnel: {
            previousUrl: "https://staging.example.com/agent",
            connectedAt: "2026-08-14T10:00:00.000Z",
          },
        },
      });
      mockList.mockResolvedValue({
        data: [stale],
        pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
      });
      mockGet.mockResolvedValue(stale);

      const session = await startAgentTunnelSession({
        port: "8000",
        agent: "agent_abc123",
      });

      expect(mockUpdate.mock.calls.length).toBeGreaterThanOrEqual(2);
      const restored = (
        mockUpdate.mock.calls[0] as [string, { config: Record<string, unknown> }]
      )[1].config;
      expect(restored.url).toBe("https://staging.example.com/agent");
      expect(restored.devTunnel).toBeUndefined();

      const applied = (
        mockUpdate.mock.calls[1] as [string, { config: Record<string, unknown> }]
      )[1].config;
      expect(applied.url).toBe(`${TUNNEL_URL}/agent`);
      expect(applied.devTunnel).toMatchObject({
        previousUrl: "https://staging.example.com/agent",
      });

      await session.shutdown(0);
    });
  });
});
