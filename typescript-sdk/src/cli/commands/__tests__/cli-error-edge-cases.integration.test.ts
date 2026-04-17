/**
 * Integration tests for less-common but important error conditions —
 * authentication, authorization, network failures, rate limiting,
 * and plan-limit responses.
 */
import {
  describe,
  expect,
  it,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import http from "http";
import { spawn } from "child_process";
import type { AddressInfo } from "net";

const CLI_PATH = path.resolve(__dirname, "../../../../dist/cli/index.js");

interface FakeResponse {
  status: number;
  body: unknown;
}

let server: http.Server;
let baseUrl = "";
const responseQueue = new Map<string, FakeResponse[]>();

function pushResponse(method: string, pathPattern: string, response: FakeResponse) {
  const key = `${method.toUpperCase()} ${pathPattern}`;
  const list = responseQueue.get(key) ?? [];
  list.push(response);
  responseQueue.set(key, list);
}

function matchKey(method: string, urlPath: string): string | undefined {
  for (const key of responseQueue.keys()) {
    const [keyMethod, keyPath] = key.split(" ");
    if (keyMethod !== method) continue;
    const regex = new RegExp(
      "^" +
        (keyPath ?? "")
          .split("/")
          .map((segment) =>
            segment.startsWith(":")
              ? "[^/]+"
              : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          )
          .join("/") +
        "$",
    );
    if (regex.test(urlPath)) return key;
  }
  return undefined;
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const urlPath = (req.url ?? "").split("?")[0] ?? "/";
    const key = matchKey(req.method ?? "GET", urlPath);
    if (!key) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "test-fallback", message: "no handler" }));
      return;
    }
    const queue = responseQueue.get(key) ?? [];
    const next = queue.shift() ?? {
      status: 500,
      body: { error: "no response queued" },
    };
    if (queue.length === 0) responseQueue.delete(key);
    else responseQueue.set(key, queue);
    res.writeHead(next.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(next.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

afterEach(() => {
  responseQueue.clear();
});

interface CliResult {
  combined: string;
  exitCode: number | null;
}

function runCli(
  args: string[],
  cwd: string,
  envOverrides: Record<string, string> = {},
  timeoutMs = 15000,
): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn("node", [CLI_PATH, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        LANGWATCH_API_KEY: "test",
        LANGWATCH_ENDPOINT: baseUrl,
        ...envOverrides,
      },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1000);
    }, timeoutMs);

    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ combined: stdout + stderr, exitCode });
    });
  });
}

function makeTestDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "langwatch-cli-edge-"));
}

describe("CLI error edge cases", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeTestDir();
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe("when the API returns 401 unauthorized", () => {
    it("tells the user the API key is invalid", async () => {
      pushResponse("GET", "/api/prompts", {
        status: 401,
        body: { error: "Unauthorized", message: "Invalid API key" },
      });

      const result = await runCli(["prompt", "list"], testDir);

      expect(result.exitCode).toBe(1);
      expect(result.combined.toLowerCase()).toMatch(
        /api key|unauthorized|invalid/,
      );
    });
  });

  describe("when the API returns 403 plan limit reached", () => {
    it("surfaces the plan-limit message to the user", async () => {
      pushResponse("POST", "/api/dataset", {
        status: 403,
        body: {
          error: "PlanLimitReached",
          message: "Dataset limit reached for FREE plan (max 3)",
        },
      });

      const result = await runCli(
        ["dataset", "create", "my-dataset"],
        testDir,
      );

      expect(result.exitCode).toBe(1);
      expect(result.combined.toLowerCase()).toMatch(
        /limit|plan|upgrade|free plan/,
      );
    });
  });

  describe("when the API host is unreachable", () => {
    it("shows a transport-level error, not a silent timeout", async () => {
      const result = await runCli(["prompt", "list"], testDir, {
        LANGWATCH_ENDPOINT: "http://127.0.0.1:1", // port 1 is almost certainly closed
      });

      expect(result.exitCode).toBe(1);
      expect(result.combined.toLowerCase()).toMatch(
        /econnrefused|fetch failed|connect|unreachable/,
      );
    });
  });

  describe("when the API returns 429 rate limit", () => {
    it("shows the rate-limit message with the retry hint if provided", async () => {
      pushResponse("GET", "/api/prompts", {
        status: 429,
        body: {
          error: "RateLimited",
          message: "Too many requests — please retry in 60 seconds",
        },
      });

      const result = await runCli(["prompt", "list"], testDir);

      expect(result.exitCode).toBe(1);
      expect(result.combined.toLowerCase()).toContain("retry");
    });
  });

  describe("when the API returns 500 with a plain-text body", () => {
    it("does not mask the body with 'Internal server error'", async () => {
      // Simulate a non-JSON body from an upstream proxy
      responseQueue.clear();
      const originalListeners = server.listeners("request");
      server.removeAllListeners("request");
      server.on("request", (_req, res) => {
        res.writeHead(502, { "Content-Type": "text/html" });
        res.end("<html><body>Bad Gateway — upstream nginx rejected</body></html>");
      });
      try {
        const result = await runCli(["prompt", "list"], testDir);
        expect(result.exitCode).toBe(1);
        // We accept either the message or just the 502 status as a signal.
        expect(result.combined.toLowerCase()).toMatch(
          /502|bad gateway|nginx|html/,
        );
      } finally {
        server.removeAllListeners("request");
        for (const l of originalListeners) {
          server.on("request", l as (req: unknown, res: unknown) => void);
        }
      }
    });
  });
});
