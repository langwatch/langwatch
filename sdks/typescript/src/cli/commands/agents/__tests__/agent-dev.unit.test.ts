import { EventEmitter } from "node:events";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import {
  agentDevCommand,
  applyDevTunnel,
  DEV_SECRET_HEADER,
  deriveSimulationsUrl,
  restoreDevTunnel,
  startAgentDevSession,
  startAuthProxy,
} from "../dev";

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

describe("applyDevTunnel()", () => {
  describe("when the agent points at a deployed URL", () => {
    /** @scenario "URL write-back replaces the agent URL and stashes the previous one" */
    it("replaces the URL and stashes the previous one under devTunnel", () => {
      const config = applyDevTunnel({
        config: { url: "https://staging.example.com/agent" },
        tunnelUrl: TUNNEL_URL,
        connectedAt: "2026-08-15T10:00:00.000Z",
      });

      // The platform posts to the agent URL verbatim, so the tunnel URL
      // keeps the previous URL's request path.
      expect(config.url).toBe(`${TUNNEL_URL}/agent`);
      expect(config.devTunnel).toEqual({
        previousUrl: "https://staging.example.com/agent",
        connectedAt: "2026-08-15T10:00:00.000Z",
      });
    });

    /** @scenario "URL write-back keeps the agent's request path on the tunnel URL" */
    it("keeps a bare tunnel URL when the previous URL has no path", () => {
      const config = applyDevTunnel({
        config: { url: "https://staging.example.com" },
        tunnelUrl: TUNNEL_URL,
      });

      expect(config.url).toBe(TUNNEL_URL);
    });

    it("carries the previous URL's query string too", () => {
      const config = applyDevTunnel({
        config: { url: "https://staging.example.com/agent/chat?tenant=acme" },
        tunnelUrl: `${TUNNEL_URL}/`,
      });

      expect(config.url).toBe(`${TUNNEL_URL}/agent/chat?tenant=acme`);
    });
  });

  describe("when a crashed session left a stale tunnel on the agent", () => {
    /** @scenario "A second session over a stale tunnel keeps the original previous URL" */
    it("stashes the original previous URL, not the dead tunnel URL", () => {
      const config = applyDevTunnel({
        config: {
          url: "https://dead-session.trycloudflare.com",
          devTunnel: {
            previousUrl: "https://staging.example.com/agent",
            connectedAt: "2026-08-14T10:00:00.000Z",
          },
        },
        tunnelUrl: TUNNEL_URL,
      });

      expect(config.url).toBe(`${TUNNEL_URL}/agent`);
      expect(
        (config.devTunnel as { previousUrl?: string }).previousUrl,
      ).toBe("https://staging.example.com/agent");
    });
  });

  describe("when a secret is minted for the session", () => {
    /** @scenario "The session secret header row is replaced, never duplicated" */
    it("replaces an existing dev-secret header row instead of appending", () => {
      const config = applyDevTunnel({
        config: {
          url: "https://staging.example.com/agent",
          headers: [
            { key: "Authorization", value: "Bearer customer-token" },
            { key: DEV_SECRET_HEADER, value: "stale-secret" },
          ],
        },
        tunnelUrl: TUNNEL_URL,
        secret: "fresh-secret",
      });

      const headers = config.headers as { key: string; value: string }[];
      const secretRows = headers.filter((h) => h.key === DEV_SECRET_HEADER);
      expect(secretRows).toEqual([
        { key: DEV_SECRET_HEADER, value: "fresh-secret" },
      ]);
      expect(headers).toContainEqual({
        key: "Authorization",
        value: "Bearer customer-token",
      });
    });
  });

  describe("when the session runs without the auth proxy", () => {
    it("removes any stale dev-secret header row", () => {
      const config = applyDevTunnel({
        config: {
          url: "https://staging.example.com/agent",
          headers: [{ key: DEV_SECRET_HEADER, value: "stale-secret" }],
        },
        tunnelUrl: TUNNEL_URL,
      });

      expect(config.headers).toEqual([]);
    });
  });
});

describe("restoreDevTunnel()", () => {
  describe("when the agent carries a devTunnel stash", () => {
    /** @scenario "Ending the session restores the agent and clears the tunnel marker" */
    it("restores the previous URL, drops devTunnel, and removes the secret header", () => {
      const restored = restoreDevTunnel({
        config: {
          url: TUNNEL_URL,
          headers: [
            { key: "Authorization", value: "Bearer customer-token" },
            { key: DEV_SECRET_HEADER, value: "session-secret" },
          ],
          devTunnel: {
            previousUrl: "https://staging.example.com/agent",
            connectedAt: "2026-08-15T10:00:00.000Z",
          },
        },
      });

      expect(restored).not.toBeNull();
      expect(restored?.url).toBe("https://staging.example.com/agent");
      expect(restored?.devTunnel).toBeUndefined();
      expect(restored?.headers).toEqual([
        { key: "Authorization", value: "Bearer customer-token" },
      ]);
    });
  });

  describe("when the agent carries no devTunnel stash", () => {
    it("returns null so a second restore is a no-op", () => {
      const restored = restoreDevTunnel({
        config: { url: "https://staging.example.com/agent" },
      });

      expect(restored).toBeNull();
    });
  });
});

describe("deriveSimulationsUrl()", () => {
  it("derives the project simulations page from the agent platform URL", () => {
    expect(deriveSimulationsUrl(makeAgent().platformUrl)).toBe(
      "https://app.langwatch.ai/my-project/simulations",
    );
  });

  it("returns undefined for an absent or unparseable URL", () => {
    expect(deriveSimulationsUrl(undefined)).toBeUndefined();
    expect(deriveSimulationsUrl("not a url")).toBeUndefined();
  });
});

describe("startAuthProxy()", () => {
  let target: http.Server;
  let targetPort: number;
  let received: { path?: string; secretHeader?: string | string[] }[];

  beforeEach(async () => {
    received = [];
    target = http.createServer((req, res) => {
      received.push({
        path: req.url,
        secretHeader: req.headers[DEV_SECRET_HEADER.toLowerCase()],
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) =>
      target.listen(0, "127.0.0.1", resolve),
    );
    targetPort = (target.address() as { port: number }).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });

  describe("when a request arrives without the session secret", () => {
    /** @scenario "The auth proxy rejects requests without the session secret" */
    it("rejects it with 401 and forwards requests that carry the secret", async () => {
      const proxy = await startAuthProxy({
        targetUrl: `http://127.0.0.1:${targetPort}/agent/chat`,
        secret: "session-secret",
      });

      const rejected = await fetch(proxy.url, { method: "POST" });
      expect(rejected.status).toBe(401);
      expect(received).toHaveLength(0);

      const accepted = await fetch(proxy.url, {
        method: "POST",
        headers: { [DEV_SECRET_HEADER]: "session-secret" },
        body: JSON.stringify({ message: "hi" }),
      });
      expect(accepted.status).toBe(200);
      expect(received).toHaveLength(1);
      // Forwarded onto the target URL's own path, with the transport-auth
      // header stripped before it reaches the local agent.
      expect(received[0]?.path).toBe("/agent/chat");
      expect(received[0]?.secretHeader).toBeUndefined();

      const wrongSecret = await fetch(proxy.url, {
        method: "POST",
        headers: { [DEV_SECRET_HEADER]: "some-other-secret" },
      });
      expect(wrongSecret.status).toBe(401);

      await proxy.close();
    });
  });
});

describe("agent dev session", () => {
  let mockGet: ReturnType<typeof vi.fn>;
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
      `lw-agent-dev-test-${process.pid}-${Math.random().toString(36).slice(2)}.json`,
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
  });

  describe("when the session starts against a local port", () => {
    /** @scenario "URL write-back replaces the agent URL and stashes the previous one" */
    it("PATCHes the agent with the tunnel URL, the stash, and the secret header", async () => {
      const session = await startAgentDevSession({
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
      const session = await startAgentDevSession({
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
      const session = await startAgentDevSession({
        port: "8000",
        agent: "agent_abc123",
      });
      mockGet.mockRejectedValue(new Error("network down"));

      await session.shutdown(0);

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("https://staging.example.com/agent"),
      );
      await expect(session.done).resolves.toBe(0);
    });
  });

  describe("when --no-update-url is passed", () => {
    /** @scenario "Opting out of the URL update touches nothing" */
    it("never PATCHes the agent, on start or on shutdown", async () => {
      const session = await startAgentDevSession({
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
      const session = await startAgentDevSession({
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
        startAgentDevSession({
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
        startAgentDevSession({
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
        startAgentDevSession({ agent: "agent_abc123" }),
      ).rejects.toThrow(ProcessExitError);
    });
  });

  describe("when the --agent flag matches nothing", () => {
    it("fails with guidance to list agents", async () => {
      await expect(
        startAgentDevSession({ port: "8000", agent: "no-such-agent" }),
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
        startAgentDevSession({ port: "8000", agent: "agent_abc123" }),
      ).rejects.toThrow(ProcessExitError);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe("when the tunnel process exits behind the session", () => {
    it("restores the agent and resolves the session", async () => {
      const session = await startAgentDevSession({
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

  describe("agentDevCommand()", () => {
    it("exits with the session's code after shutdown", async () => {
      // Detach any listener the test runner holds so emitting SIGINT reaches
      // only the command's own handler; restored below.
      const priorSigint = process.rawListeners("SIGINT");
      for (const listener of priorSigint) {
        process.removeListener("SIGINT", listener as () => void);
      }

      try {
        const commandPromise = agentDevCommand({
          port: "8000",
          agent: "agent_abc123",
        }).catch((error: unknown) => error);

        // Let the session start, then end it the way Ctrl-C would.
        await vi.waitFor(() => expect(mockUpdate).toHaveBeenCalled());
        const written = (
          mockUpdate.mock.calls[0] as [
            string,
            { config: Record<string, unknown> },
          ]
        )[1].config;
        mockGet.mockResolvedValue(makeAgent({ config: written }));
        process.emit("SIGINT");

        const outcome = await commandPromise;
        expect(outcome).toBeInstanceOf(ProcessExitError);
        expect((outcome as ProcessExitError).code).toBe(0);
      } finally {
        process.removeAllListeners("SIGINT");
        for (const listener of priorSigint) {
          process.on("SIGINT", listener as () => void);
        }
      }
    });
  });
});
