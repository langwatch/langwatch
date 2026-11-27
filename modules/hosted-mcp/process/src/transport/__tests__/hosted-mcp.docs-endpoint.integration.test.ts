/**
 * @vitest-environment node
 * The docs endpoint at `/mcp/docs` over a real listener. The session store is a Redis double
 * whose writes are watched, so "keeps no session" is observed rather than assumed.
 */
import { createServer, type Server } from "node:http";

import { redisDouble } from "@langwatch/test-harness/client-doubles/redis";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";

import { HostedMcpModule } from "../../app/hosted-mcp.app.ts";
import { LiveHostedMcpRepositories } from "../../repositories/live/live.hosted-mcp.repositories.ts";
import type { McpSessionCipher } from "../../repositories/mcp-session.repository.ts";
import type { AuthzMcpSessionGrantService } from "../../services/authz-mcp-session-grant.service.ts";
import type { McpHandler } from "../../services/mcp-endpoint.service.ts";
import type {
  McpLiveProjectLookup,
  ProjectMcpProjectLookupService,
} from "../../services/project-mcp-project-lookup.service.ts";
import { ResolvedMcpClientAddressService } from "../../services/resolved-mcp-client-address.service.ts";
import { FakeCliSessions } from "./support/fake-cli-sessions.ts";

const mockRedis = {
  get: vi.fn(),
  call: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  expire: vi.fn(),
  ttl: vi.fn(),
  sadd: vi.fn(),
  srem: vi.fn(),
  smembers: vi.fn(),
  exists: vi.fn(),
};

/** Every Redis command that would write or count a session. */
const REDIS_WRITES = ["set", "del", "expire", "sadd", "srem", "call"] as const;

class NoProjects implements Pick<ProjectMcpProjectLookupService, "resolveLiveProjectByApiKey"> {
  resolveLiveProjectByApiKey(): Promise<McpLiveProjectLookup> {
    return Promise.resolve({ kind: "unknown" });
  }
}

class NoGrants implements Pick<AuthzMcpSessionGrantService, "stillGranted"> {
  stillGranted(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

class IdentityCipher implements McpSessionCipher {
  encrypt(text: string): string {
    return text;
  }
  decrypt(text: string): string {
    return text;
  }
}

const DOCS_PAGE = "# Tracing\n\nInstrument your agent with the LangWatch SDK.";

const MCP_ACCEPT = "application/json, text/event-stream";

let server: Server;
let handler: McpHandler;
let origin: string;
let docsFetch: MockInstance<typeof fetch>;
/** How langwatch.ai answers a docs fetch; a test replaces it to hold or watch fetches. */
let answerDocs: (signal: AbortSignal | undefined) => Promise<Response>;

function docsPage(): Response {
  return new Response(DOCS_PAGE, { status: 200, headers: { "content-type": "text/markdown" } });
}

/** Polls until `ready` holds, so a test can wait on work the server started in the background. */
async function eventually(ready: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !ready(); attempt++) {
    await new Promise((done) => setTimeout(done, 10));
  }
  expect(ready()).toBe(true);
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/** The URLs the docs tools asked for: every fetch that was not this test calling its server. */
function fetchedDocsUrls(): string[] {
  return docsFetch.mock.calls
    .map(([input]) => urlOf(input))
    .filter((url) => !url.startsWith(origin));
}

async function send({
  path = "/mcp/docs",
  method = "POST",
  body,
  rawBody,
  headers = {},
  signal,
}: {
  path?: string;
  method?: string;
  body?: unknown;
  /** Sent as is, for a body that is not one JSON document's worth of test data. */
  rawBody?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}) {
  const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
  const res = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(payload === undefined ? {} : { "content-type": "application/json", accept: MCP_ACCEPT }),
      ...headers,
    },
    body: payload,
    signal,
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    json: (): Record<string, unknown> => JSON.parse(text) as Record<string, unknown>,
  };
}

function initialize(id = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "docs-test-client", version: "1.0.0" },
    },
  };
}

function listTools(id = 2) {
  return { jsonrpc: "2.0", id, method: "tools/list", params: {} };
}

function callTool(name: string, args: Record<string, unknown>, id = 3) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

function toolNamesOf(response: Record<string, unknown>): string[] {
  const result = response.result as { tools: { name: string }[] };
  return result.tools.map((tool) => tool.name);
}

/** A tool call's text and whether it was answered as an error, in either of MCP's two shapes. */
function toolOutcomeOf(response: Record<string, unknown>): { isError: boolean; text: string } {
  if (response.error) {
    return { isError: true, text: String((response.error as { message: string }).message) };
  }
  const result = response.result as { isError?: boolean; content: { text: string }[] };
  return {
    isError: result.isError === true,
    text: result.content.map((part) => part.text).join("\n"),
  };
}

beforeAll(async () => {
  handler = HostedMcpModule.fromDependencies({
    repositories: LiveHostedMcpRepositories.create({
      redis: redisDouble(mockRedis),
      encryption: new IdentityCipher(),
    }),
    projects: new NoProjects(),
    grants: new NoGrants(),
    cliSessions: new FakeCliSessions(),
    address: ResolvedMcpClientAddressService.create(),
    baseHost: "https://app.langwatch.ai",
  }).createHandler();

  server = createServer((req, res) => handler.handleRequest(req, res));
  await new Promise<void>((done) => {
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  await handler.closeAllSessions();
  await new Promise<void>((done) => {
    server.close(() => done());
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  mockRedis.get.mockResolvedValue(null);
  mockRedis.call.mockResolvedValue(null);
  mockRedis.set.mockResolvedValue("OK");
  mockRedis.smembers.mockResolvedValue([]);
  mockRedis.exists.mockResolvedValue(0);
  answerDocs = () => Promise.resolve(docsPage());
  // The docs tools fetch langwatch.ai; this test's own requests to its listener pass through.
  const realFetch = globalThis.fetch;
  docsFetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (urlOf(input).startsWith(origin)) return realFetch(input, init);
      return answerDocs(init?.signal ?? undefined);
    });
});

afterEach(() => {
  docsFetch.mockRestore();
});

describe("given a client with no credential", () => {
  describe("when it lists the tools at /mcp/docs", () => {
    /** @scenario "An anonymous client at the docs endpoint lists exactly the docs tools" */
    it("sees the two docs tools and nothing else", async () => {
      const res = await send({ body: listTools() });

      expect(res.status).toBe(200);
      expect(toolNamesOf(res.json()).toSorted()).toEqual([
        "fetch_langwatch_docs",
        "fetch_scenario_docs",
      ]);
    });
  });

  describe("when it initializes at /mcp/docs", () => {
    it("is answered as the LangWatch server", async () => {
      const res = await send({ body: initialize() });

      expect(res.status).toBe(200);
      const result = res.json().result as { serverInfo: { name: string } };
      expect(result.serverInfo.name).toBe("LangWatch");
    });
  });

  describe("when it calls fetch_langwatch_docs for a page under the docs", () => {
    /** @scenario "A docs tool at the docs endpoint returns a docs page" */
    it("returns the page fetched from langwatch.ai/docs", async () => {
      const res = await send({
        body: callTool("fetch_langwatch_docs", { url: "observability/tracing" }),
      });

      expect(res.status).toBe(200);
      expect(toolOutcomeOf(res.json())).toEqual({ isError: false, text: DOCS_PAGE });
      expect(fetchedDocsUrls()).toEqual(["https://langwatch.ai/docs/observability/tracing.md"]);
    });
  });

  describe("when it calls fetch_langwatch_docs with a URL on another host", () => {
    /** @scenario "The docs endpoint refuses a URL outside the docs" */
    it("answers a tool error naming the trusted docs address and fetches nothing", async () => {
      const res = await send({
        body: callTool("fetch_langwatch_docs", { url: "https://attacker.example/docs/x.md" }),
      });

      expect(res.status).toBe(200);
      const outcome = toolOutcomeOf(res.json());
      expect(outcome.isError).toBe(true);
      expect(outcome.text).toContain("https://langwatch.ai/docs/");
      expect(fetchedDocsUrls()).toEqual([]);
    });
  });

  describe("when it calls a project tool at /mcp/docs", () => {
    /** @scenario "The docs endpoint serves no project tool" */
    it("is refused as a tool the server does not have", async () => {
      const res = await send({ body: callTool("search_traces", {}) });

      const outcome = toolOutcomeOf(res.json());
      expect(outcome.isError).toBe(true);
      expect(outcome.text).toMatch(/search_traces not found/);
      expect(fetchedDocsUrls()).toEqual([]);
    });
  });

  describe("when it initializes and calls a docs tool", () => {
    /** @scenario "The docs endpoint keeps no session" */
    it("is given no session id and no session record is written", async () => {
      const opened = await send({ body: initialize() });
      const called = await send({ body: callTool("fetch_scenario_docs", {}) });

      expect(opened.headers.get("mcp-session-id")).toBeNull();
      expect(called.headers.get("mcp-session-id")).toBeNull();
      expect(toolOutcomeOf(called.json()).isError).toBe(false);
      for (const command of REDIS_WRITES) {
        expect(mockRedis[command], `redis ${command}`).not.toHaveBeenCalled();
      }
    });
  });

  describe("when it sends an initialize request to /mcp", () => {
    /** @scenario "The MCP endpoint still asks an anonymous client to sign in" */
    it("answers 401 with a WWW-Authenticate challenge", async () => {
      const res = await send({ path: "/mcp", body: initialize() });

      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe(
        'Bearer resource_metadata="https://app.langwatch.ai/.well-known/oauth-protected-resource"',
      );
    });
  });
});

describe("given a client presenting a bearer that is not valid", () => {
  describe("when it lists the tools at /mcp/docs", () => {
    /** @scenario "A credential sent to the docs endpoint is neither checked nor used" */
    it("is served the docs tools rather than asked to sign in", async () => {
      const res = await send({
        body: listTools(),
        headers: { authorization: "Bearer not-a-real-token" },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("www-authenticate")).toBeNull();
      expect(toolNamesOf(res.json())).toContain("fetch_langwatch_docs");
      expect(mockRedis.get).not.toHaveBeenCalled();
    });
  });
});

describe("when a client sends GET or DELETE to /mcp/docs", () => {
  /** @scenario "The docs endpoint answers only POST" */
  it.each(["GET", "DELETE"])("answers %s with 405", async (method) => {
    const res = await send({ method, headers: { accept: MCP_ACCEPT } });

    expect(res.status).toBe(405);
    expect(res.json()).toEqual({ error: "Method not allowed" });
  });
});

describe("when a browser sends a CORS preflight to /mcp/docs", () => {
  /** @scenario "A browser client's preflight to the docs endpoint is answered" */
  it("answers 200 with headers allowing any origin", async () => {
    const res = await send({
      method: "OPTIONS",
      headers: {
        origin: "https://langwatch.ai",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain("Content-Type");
  });
});

describe("given a client with no credential that sends more than one message's worth", () => {
  describe("when it posts a JSON-RPC batch of docs tool calls", () => {
    /** @scenario "A batch sent to the docs endpoint is refused" */
    it("answers 400 with a JSON-RPC invalid request error and fetches nothing", async () => {
      const batch = [
        callTool("fetch_langwatch_docs", { url: "batch/one" }, 1),
        callTool("fetch_langwatch_docs", { url: "batch/two" }, 2),
      ];

      const res = await send({ body: batch });

      expect(res.status).toBe(400);
      expect(res.json()).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32600 } });
      expect(fetchedDocsUrls()).toEqual([]);
    });
  });

  describe("when it posts a body larger than 64 KB", () => {
    /** @scenario "An oversized body sent to the docs endpoint is refused" */
    it("answers 413 and fetches nothing", async () => {
      const oversized = callTool("fetch_langwatch_docs", { url: `big/${"x".repeat(70 * 1024)}` });

      const res = await send({ rawBody: JSON.stringify(oversized) });

      expect(res.status).toBe(413);
      expect(fetchedDocsUrls()).toEqual([]);
    });
  });
});

describe("given 16 docs fetches from the docs endpoint are still in flight", () => {
  describe("when another client calls a docs tool for a page not yet fetched", () => {
    /** @scenario "Docs fetches beyond the endpoint's bound are refused rather than queued" */
    it("answers a tool error asking it to retry and starts no further fetch", async () => {
      const releases: (() => void)[] = [];
      answerDocs = () =>
        releases.length < 16
          ? new Promise((resolve) => releases.push(() => resolve(docsPage())))
          : Promise.resolve(docsPage());
      const held = Array.from({ length: 16 }, (_, index) =>
        send({ body: callTool("fetch_langwatch_docs", { url: `bound/held-${index}` }, index) }),
      );
      await eventually(() => releases.length === 16);

      const refused = await send({
        body: callTool("fetch_langwatch_docs", { url: "bound/one-more" }),
      });

      const outcome = toolOutcomeOf(refused.json());
      expect(outcome.isError).toBe(true);
      expect(outcome.text).toMatch(/busy.*Retry/);
      expect(fetchedDocsUrls()).toHaveLength(16);

      for (const release of releases) release();
      for (const res of await Promise.all(held)) {
        expect(toolOutcomeOf(res.json()).isError).toBe(false);
      }
    });
  });
});

describe("given a client fetched a docs page through the docs endpoint", () => {
  describe("when another client asks for the same page within a minute", () => {
    /** @scenario "A repeated docs page is served from the cache" */
    it("is given the same text without a second fetch", async () => {
      const page = callTool("fetch_scenario_docs", { url: "cache/repeated-page" });

      const first = await send({ body: page });
      const second = await send({ body: page });

      expect(toolOutcomeOf(first.json())).toEqual({ isError: false, text: DOCS_PAGE });
      expect(toolOutcomeOf(second.json())).toEqual({ isError: false, text: DOCS_PAGE });
      expect(fetchedDocsUrls()).toEqual(["https://langwatch.ai/scenario/cache/repeated-page.md"]);
    });
  });
});

describe("given a client's docs tool call is waiting on a docs page", () => {
  describe("when the client disconnects", () => {
    /** @scenario "A client that disconnects stops its docs fetch" */
    it("aborts the fetch for that page", async () => {
      let fetchSignal: AbortSignal | undefined;
      answerDocs = (signal) => {
        fetchSignal = signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason));
        });
      };
      const client = new AbortController();
      const pending = send({
        body: callTool("fetch_langwatch_docs", { url: "disconnect/slow-page" }),
        signal: client.signal,
      }).catch(() => undefined);
      await eventually(() => fetchSignal !== undefined);

      client.abort();
      await pending;

      await eventually(() => fetchSignal?.aborted === true);
      expect(fetchSignal?.aborted).toBe(true);
    });
  });
});
