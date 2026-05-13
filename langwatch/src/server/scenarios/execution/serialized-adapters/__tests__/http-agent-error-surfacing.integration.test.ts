/**
 * @vitest-environment node
 *
 * Integration regression tests for issue #3576.
 *
 * The `SerializedHttpAgentAdapter` used to throw `HTTP <status>: <statusText>`
 * on non-2xx responses and discarded the response body, request URL, and
 * upstream identifiers. These tests drive the adapter against a real
 * in-process HTTP stub server and assert the richer error surface (AC #2)
 * and per-call diagnostic logging (AC #4) that the fix provides.
 *
 * The adapter wires its own logger by default via `createChildProcessLogger`
 * (see #3779). For test capture we inject a fake logger through the
 * constructor's second parameter — same pattern as
 * http-agent.adapter.logging.unit.test.ts.
 */

import { AgentRole, type AgentInput } from "@langwatch/scenario";
import http from "node:http";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { HttpAgentData } from "../../types";
import { SerializedHttpAgentAdapter } from "../http-agent.adapter";

// ---------------------------------------------------------------------------
// Bypass SSRF validation so the adapter can reach 127.0.0.1 in tests.
// Established pattern: same as http-trace-propagation.integration.test.ts.
// ---------------------------------------------------------------------------
vi.mock("~/utils/ssrfProtection", () => ({
  ssrfSafeFetch: async (url: string, init?: RequestInit) => fetch(url, init),
}));

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** Expected redaction placeholder the fix must use for sensitive headers. */
const REDACTED = "[REDACTED]";

/** The fix must truncate error bodies at or below this length. */
const BODY_TRUNCATION_LIMIT = 2048;

// ---------------------------------------------------------------------------
// Stub server
// ---------------------------------------------------------------------------

interface StubConfig {
  status: number;
  headers?: Record<string, string>;
  body: string;
  contentType?: string;
}

interface StubServer {
  url: string;
  configure: (cfg: StubConfig) => void;
  close: () => Promise<void>;
}

async function createStubServer(): Promise<StubServer> {
  let current: StubConfig = {
    status: 200,
    body: JSON.stringify({ message: "ok" }),
    contentType: "application/json",
  };

  const server = http.createServer((_req, res) => {
    const cfg = current;
    res.statusCode = cfg.status;
    res.setHeader("Content-Type", cfg.contentType ?? "application/json");
    for (const [k, v] of Object.entries(cfg.headers ?? {})) {
      res.setHeader(k, v);
    }
    res.end(cfg.body);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };

  return {
    url: `http://127.0.0.1:${port}`,
    configure: (cfg) => {
      current = cfg;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

// ---------------------------------------------------------------------------
// Fake logger — captures every call to info/warn/error for assertion.
// Mirrors the makeFakeLogger pattern from
// http-agent.adapter.logging.unit.test.ts.
// ---------------------------------------------------------------------------

interface FakeLogger {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  child: () => FakeLogger;
}

function makeFakeLogger(): FakeLogger {
  const fake: FakeLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => fake,
  };
  return fake;
}

function loggerArg(logger: FakeLogger) {
  return logger as unknown as ConstructorParameters<
    typeof SerializedHttpAgentAdapter
  >[1];
}

function collectEntries(logger: FakeLogger): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = [];
  for (const level of ["info", "warn", "error", "debug"] as const) {
    for (const call of logger[level].mock.calls) {
      const [obj, msg] = call;
      entries.push({
        level,
        msg,
        ...(typeof obj === "object" && obj !== null
          ? (obj as Record<string, unknown>)
          : {}),
      });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Shared input fixture
// ---------------------------------------------------------------------------

const baseInput: AgentInput = {
  threadId: "thread_test",
  messages: [{ role: "user", content: "hello" }],
  newMessages: [{ role: "user", content: "hello" }],
  requestedRole: AgentRole.AGENT,
  scenarioState: {} as AgentInput["scenarioState"],
  scenarioConfig: {} as AgentInput["scenarioConfig"],
};

function makeConfig(
  url: string,
  overrides?: Partial<HttpAgentData>,
): HttpAgentData {
  return {
    type: "http",
    agentId: "agent_test",
    url,
    method: "POST",
    headers: [],
    outputPath: "$.message",
    ...overrides,
  };
}

// ============================================================================
// AC #2 — Error context on non-2xx responses
// ============================================================================

describe("given an HTTP agent target pointed at a stub returning 422 with a JSON error body", () => {
  let stub: StubServer;
  const REQUEST_ID = "req-abc-123";

  beforeAll(async () => {
    stub = await createStubServer();
  });
  afterAll(async () => {
    await stub.close();
  });

  beforeEach(() => {
    stub.configure({
      status: 422,
      headers: { "x-request-id": REQUEST_ID },
      body: JSON.stringify({
        error: "Unprocessable Entity",
        detail: "invalid input",
      }),
      contentType: "application/json",
    });
  });

  describe("when the adapter calls the stub", () => {
    it("includes the request URL in the thrown error", async () => {
      const adapter = new SerializedHttpAgentAdapter(
        makeConfig(stub.url),
        loggerArg(makeFakeLogger()),
      );
      await expect(adapter.call(baseInput)).rejects.toThrow(stub.url);
    });

    it("includes the response status 422 in the thrown error", async () => {
      const adapter = new SerializedHttpAgentAdapter(
        makeConfig(stub.url),
        loggerArg(makeFakeLogger()),
      );
      await expect(adapter.call(baseInput)).rejects.toThrow("422");
    });

    /** @scenario HTTP agent error includes response body, URL, and upstream request id */
    it("includes the response body in the thrown error", async () => {
      const adapter = new SerializedHttpAgentAdapter(
        makeConfig(stub.url),
        loggerArg(makeFakeLogger()),
      );
      // "invalid input" comes from the JSON body
      await expect(adapter.call(baseInput)).rejects.toThrow("invalid input");
    });

    it("includes the x-request-id response header value in the thrown error", async () => {
      const adapter = new SerializedHttpAgentAdapter(
        makeConfig(stub.url),
        loggerArg(makeFakeLogger()),
      );
      await expect(adapter.call(baseInput)).rejects.toThrow(REQUEST_ID);
    });
  });
});

describe("given an HTTP agent target pointed at a stub returning 500 with a body larger than the truncation limit", () => {
  let stub: StubServer;
  const LARGE_BODY = "E".repeat(BODY_TRUNCATION_LIMIT * 2);

  beforeAll(async () => {
    stub = await createStubServer();
  });
  afterAll(async () => {
    await stub.close();
  });

  beforeEach(() => {
    stub.configure({
      status: 500,
      body: LARGE_BODY,
      contentType: "text/plain",
    });
  });

  describe("when the adapter calls the stub", () => {
    /** @scenario HTTP agent error truncates large response bodies */
    it("includes a truncated portion of the body in the thrown error", async () => {
      const adapter = new SerializedHttpAgentAdapter(
        makeConfig(stub.url),
        loggerArg(makeFakeLogger()),
      );
      let message = "";
      try {
        await adapter.call(baseInput);
      } catch (e) {
        message = (e as Error).message;
      }
      // The error must contain at least the first 100 chars of the body
      expect(message).toContain(LARGE_BODY.slice(0, 100));
    });

    it("indicates the body was truncated in the thrown error", async () => {
      const adapter = new SerializedHttpAgentAdapter(
        makeConfig(stub.url),
        loggerArg(makeFakeLogger()),
      );
      let message = "";
      try {
        await adapter.call(baseInput);
      } catch (e) {
        message = (e as Error).message;
      }
      // Any common truncation marker: "...", "…", "[truncated]", "(truncated)"
      expect(message).toMatch(/\.\.\.|…|\[truncated\]|\(truncated\)/i);
    });
  });
});

describe("given an HTTP agent target pointed at a stub returning 502 with a plain-text body", () => {
  let stub: StubServer;
  const PLAIN_TEXT_BODY = "Bad Gateway: upstream timed out";

  beforeAll(async () => {
    stub = await createStubServer();
  });
  afterAll(async () => {
    await stub.close();
  });

  beforeEach(() => {
    stub.configure({
      status: 502,
      body: PLAIN_TEXT_BODY,
      contentType: "text/plain",
    });
  });

  describe("when the adapter calls the stub", () => {
    /** @scenario HTTP agent error reads non-JSON response bodies as text */
    it("includes the plain-text body content in the thrown error", async () => {
      const adapter = new SerializedHttpAgentAdapter(
        makeConfig(stub.url),
        loggerArg(makeFakeLogger()),
      );
      await expect(adapter.call(baseInput)).rejects.toThrow(PLAIN_TEXT_BODY);
    });
  });
});

describe("given an HTTP agent target returning 422 with x-amzn-requestid (no x-request-id)", () => {
  let stub: StubServer;
  const AMZN_ID = "amzn-req-xyz-789";

  beforeAll(async () => {
    stub = await createStubServer();
  });
  afterAll(async () => {
    await stub.close();
  });

  beforeEach(() => {
    stub.configure({
      status: 422,
      headers: { "x-amzn-requestid": AMZN_ID },
      body: JSON.stringify({ error: "validation failed" }),
      contentType: "application/json",
    });
  });

  describe("when the adapter calls the stub", () => {
    /** @scenario HTTP agent error surfaces alternate upstream identifier headers */
    it("includes the x-amzn-requestid header value in the thrown error", async () => {
      const adapter = new SerializedHttpAgentAdapter(
        makeConfig(stub.url),
        loggerArg(makeFakeLogger()),
      );
      await expect(adapter.call(baseInput)).rejects.toThrow(AMZN_ID);
    });
  });
});

describe("given a request that sets Authorization and x-api-key headers", () => {
  let stub: StubServer;

  beforeAll(async () => {
    stub = await createStubServer();
  });
  afterAll(async () => {
    await stub.close();
  });

  beforeEach(() => {
    stub.configure({
      status: 422,
      body: JSON.stringify({ error: "forbidden" }),
      contentType: "application/json",
    });
  });

  describe("when the adapter formats those request headers for logging or error context", () => {
    /** @scenario HTTP agent error redacts sensitive request headers */
    it("replaces the values of Authorization and x-api-key with a redacted placeholder", async () => {
      const config = makeConfig(stub.url, {
        headers: [{ key: "x-api-key", value: "my-secret-key" }],
        auth: { type: "bearer", token: "super-secret-token" },
      });
      const adapter = new SerializedHttpAgentAdapter(
        config,
        loggerArg(makeFakeLogger()),
      );

      let message = "";
      try {
        await adapter.call(baseInput);
      } catch (e) {
        message = (e as Error).message;
      }

      // Secret values must NOT appear in the error message
      expect(message).not.toContain("super-secret-token");
      expect(message).not.toContain("my-secret-key");

      // If the error includes those header names, it must show the redacted placeholder
      if (message.includes("Authorization") || message.includes("x-api-key")) {
        expect(message).toContain(REDACTED);
      }
    });
  });
});

// ============================================================================
// AC #4 — Per-call diagnostic logging
// ============================================================================

describe("given an HTTP agent target pointed at a stub returning 200 (for diagnostic logging)", () => {
  let stub: StubServer;
  let logger: FakeLogger;
  const REQUEST_ID = "diag-req-001";

  beforeAll(async () => {
    stub = await createStubServer();
  });
  afterAll(async () => {
    await stub.close();
  });

  beforeEach(() => {
    stub.configure({
      status: 200,
      headers: { "x-request-id": REQUEST_ID },
      body: JSON.stringify({ message: "success" }),
      contentType: "application/json",
    });
    logger = makeFakeLogger();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when the adapter calls the stub", () => {
    /** @scenario HTTP agent emits one diagnostic log line per successful call */
    it("emits a structured diagnostic log line on success", async () => {
      const adapter = new SerializedHttpAgentAdapter(
        makeConfig(stub.url),
        loggerArg(logger),
      );
      await adapter.call(baseInput).catch(() => undefined);
      const entries = collectEntries(logger);
      expect(entries.length).toBeGreaterThanOrEqual(1);
    });

    it("includes the request URL in the log line", async () => {
      const adapter = new SerializedHttpAgentAdapter(
        makeConfig(stub.url),
        loggerArg(logger),
      );
      await adapter.call(baseInput).catch(() => undefined);
      const serialized = JSON.stringify(collectEntries(logger));
      // URL is redacted to origin + pathname; we used a path-less stub URL,
      // so the origin alone must appear.
      const expectedOrigin = new URL(stub.url).origin;
      expect(serialized).toContain(expectedOrigin);
    });

    it("includes the HTTP method in the log line", async () => {
      const adapter = new SerializedHttpAgentAdapter(
        makeConfig(stub.url),
        loggerArg(logger),
      );
      await adapter.call(baseInput).catch(() => undefined);
      const serialized = JSON.stringify(collectEntries(logger));
      expect(serialized).toMatch(/POST/i);
    });

    it("includes the response status 200 in the log line", async () => {
      const adapter = new SerializedHttpAgentAdapter(
        makeConfig(stub.url),
        loggerArg(logger),
      );
      await adapter.call(baseInput).catch(() => undefined);
      const hasStatus = collectEntries(logger).some(
        (e) => e.statusCode === 200,
      );
      expect(hasStatus).toBe(true);
    });

    it("includes a durationMs field in the log line", async () => {
      const adapter = new SerializedHttpAgentAdapter(
        makeConfig(stub.url),
        loggerArg(logger),
      );
      await adapter.call(baseInput).catch(() => undefined);
      const hasDuration = collectEntries(logger).some(
        (e) => typeof e.durationMs === "number",
      );
      expect(hasDuration).toBe(true);
    });

    it("includes the upstream x-request-id in the log line", async () => {
      const adapter = new SerializedHttpAgentAdapter(
        makeConfig(stub.url),
        loggerArg(logger),
      );
      await adapter.call(baseInput).catch(() => undefined);
      const serialized = JSON.stringify(collectEntries(logger));
      expect(serialized).toContain(REQUEST_ID);
    });
  });
});

describe("given an HTTP agent target pointed at a stub returning 422 (for diagnostic logging)", () => {
  let stub: StubServer;
  let logger: FakeLogger;

  beforeAll(async () => {
    stub = await createStubServer();
  });
  afterAll(async () => {
    await stub.close();
  });

  beforeEach(() => {
    stub.configure({
      status: 422,
      headers: { "x-request-id": "fail-req-999" },
      body: JSON.stringify({
        error: "Unprocessable Entity",
        detail: "bad payload",
      }),
      contentType: "application/json",
    });
    logger = makeFakeLogger();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when the adapter calls the stub", () => {
    /** @scenario HTTP agent emits one diagnostic log line per failing call */
    it("emits a structured diagnostic log line for a failing call", async () => {
      const adapter = new SerializedHttpAgentAdapter(
        makeConfig(stub.url),
        loggerArg(logger),
      );
      await adapter.call(baseInput).catch(() => undefined);
      const entries = collectEntries(logger);
      expect(entries.length).toBeGreaterThanOrEqual(1);
    });

    it("includes response status 422 in the log line", async () => {
      const adapter = new SerializedHttpAgentAdapter(
        makeConfig(stub.url),
        loggerArg(logger),
      );
      await adapter.call(baseInput).catch(() => undefined);
      const hasStatus = collectEntries(logger).some(
        (e) => e.statusCode === 422,
      );
      expect(hasStatus).toBe(true);
    });

    it("includes a sample of the response body in the log line", async () => {
      const adapter = new SerializedHttpAgentAdapter(
        makeConfig(stub.url),
        loggerArg(logger),
      );
      await adapter.call(baseInput).catch(() => undefined);
      const serialized = JSON.stringify(collectEntries(logger));
      // The warn log includes the response body preview.
      expect(serialized).toMatch(/responseBodyPreview|body/i);
      expect(serialized).toContain("bad payload");
    });
  });
});

describe("given an HTTP agent target pointed at a stub returning a JSON 200 response", () => {
  let stub: StubServer;

  beforeAll(async () => {
    stub = await createStubServer();
  });
  afterAll(async () => {
    await stub.close();
  });

  beforeEach(() => {
    stub.configure({
      status: 200,
      body: JSON.stringify({ message: "hello from stub" }),
      contentType: "application/json",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when the adapter calls the stub", () => {
    it("emits the diagnostic log line", async () => {
      const logger = makeFakeLogger();
      const adapter = new SerializedHttpAgentAdapter(
        makeConfig(stub.url),
        loggerArg(logger),
      );
      await adapter.call(baseInput).catch(() => undefined);
      expect(collectEntries(logger).length).toBeGreaterThanOrEqual(1);
    });

    /** @scenario Diagnostic log preserves response body for the success path */
    it("still returns the parsed JSON response to its caller after logging", async () => {
      // Verifies the response value pipeline is unaffected by logging.
      const logger = makeFakeLogger();
      const adapter = new SerializedHttpAgentAdapter(
        makeConfig(stub.url),
        loggerArg(logger),
      );
      // outputPath "$.message" extracts { message: "hello from stub" }.message
      const result = await adapter.call(baseInput);
      expect(result).toBe("hello from stub");
    });
  });
});

describe("given a request that sets Authorization and x-api-key headers (diagnostic log redaction)", () => {
  let stub: StubServer;

  beforeAll(async () => {
    stub = await createStubServer();
  });
  afterAll(async () => {
    await stub.close();
  });

  beforeEach(() => {
    stub.configure({
      status: 200,
      body: JSON.stringify({ message: "ok" }),
      contentType: "application/json",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when the diagnostic log line is emitted for that request", () => {
    /** @scenario Diagnostic log redacts sensitive request headers */
    it("does not include the Authorization or x-api-key values in the log line", async () => {
      const logger = makeFakeLogger();
      const config = makeConfig(stub.url, {
        headers: [{ key: "x-api-key", value: "secret-api-key-value" }],
        auth: { type: "bearer", token: "very-secret-bearer-token" },
      });
      const adapter = new SerializedHttpAgentAdapter(config, loggerArg(logger));
      await adapter.call(baseInput).catch(() => undefined);

      const serialized = JSON.stringify(collectEntries(logger));
      expect(serialized).not.toContain("very-secret-bearer-token");
      expect(serialized).not.toContain("secret-api-key-value");
    });

    it("includes the redacted placeholder in place of sensitive header values", async () => {
      const logger = makeFakeLogger();
      const config = makeConfig(stub.url, {
        headers: [{ key: "x-api-key", value: "secret-api-key-value" }],
        auth: { type: "bearer", token: "very-secret-bearer-token" },
      });
      const adapter = new SerializedHttpAgentAdapter(config, loggerArg(logger));
      await adapter.call(baseInput).catch(() => undefined);

      const serialized = JSON.stringify(collectEntries(logger));
      // Only assert the placeholder if the log includes the header names at all
      if (serialized.includes("Authorization") || serialized.includes("x-api-key")) {
        expect(serialized).toContain(REDACTED);
      }
    });
  });
});
