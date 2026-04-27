/**
 * Integration tests asserting that the CLI surfaces actionable error
 * messages from the API instead of generic "Internal server error" blobs.
 *
 * Each scenario:
 *   1. Spins up a tiny HTTP server returning a known error body.
 *   2. Spawns the built CLI binary with a temp working directory pointing
 *      at that server via env vars.
 *   3. Asserts on the CLI stdout/stderr the user would actually see.
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
    const next = queue.shift() ?? { status: 500, body: { error: "no response queued" } };
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
  stdout: string;
  stderr: string;
  combined: string;
  exitCode: number | null;
}

function runCli(args: string[], cwd: string, timeoutMs = 15000): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn("node", [CLI_PATH, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        LANGWATCH_API_KEY: "test",
        LANGWATCH_ENDPOINT: baseUrl,
      },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      // Force kill if SIGTERM doesn't work
      setTimeout(() => child.kill("SIGKILL"), 1000);
    }, timeoutMs);

    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({
        stdout,
        stderr,
        combined: stdout + stderr,
        exitCode,
      });
    });
  });
}

function makeTestDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "langwatch-cli-err-"));
}

describe("CLI surfaces meaningful error messages from the API", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeTestDir();
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe("when prompt sync hits a 409 conflict for an active handle", () => {
    it("shows the descriptive conflict message, not 'Internal server error'", async () => {
      await runCli(["prompt", "init"], testDir);
      await runCli(["prompt", "create", "my-prompt"], testDir);

      // Pull (push.ts fetches existing prompts before pushing) returns empty
      pushResponse("GET", "/api/prompts/:id", {
        status: 404,
        body: { error: "NotFoundError", message: "Prompt not found" },
      });
      // Sync returns 409 conflict
      pushResponse("POST", "/api/prompts/:id/sync", {
        status: 409,
        body: {
          error: "Conflict",
          message: "Prompt handle already exists for scope PROJECT",
        },
      });

      const result = await runCli(["prompt", "sync"], testDir);

      expect(result.exitCode).toBe(1);
      expect(result.combined.toLowerCase()).toContain(
        "handle already exists",
      );
      expect(result.combined.toLowerCase()).not.toContain(
        "failed to sync prompt: internal server error",
      );
    });
  });

  describe("when the API returns a 500 with a non-generic message field", () => {
    it("propagates the descriptive message instead of just the kind label", async () => {
      await runCli(["prompt", "init"], testDir);
      await runCli(["prompt", "create", "my-prompt"], testDir);

      pushResponse("GET", "/api/prompts/:id", {
        status: 404,
        body: { error: "NotFoundError", message: "Prompt not found" },
      });
      pushResponse("POST", "/api/prompts/:id/sync", {
        status: 500,
        body: {
          error: "Internal server error",
          message: "database connection refused",
        },
      });

      const result = await runCli(["prompt", "sync"], testDir);

      expect(result.exitCode).toBe(1);
      expect(result.combined.toLowerCase()).toContain("connection refused");
    });
  });

  describe("when the API returns a 500 with no message field at all", () => {
    it("falls back to the raw JSON payload so the user has a clue", async () => {
      await runCli(["prompt", "init"], testDir);
      await runCli(["prompt", "create", "my-prompt"], testDir);

      pushResponse("GET", "/api/prompts/:id", {
        status: 404,
        body: { error: "NotFoundError", message: "Prompt not found" },
      });
      pushResponse("POST", "/api/prompts/:id/sync", {
        status: 500,
        body: { code: "MYSTERY_CODE", details: { traceId: "tr_123" } },
      });

      const result = await runCli(["prompt", "sync"], testDir);

      expect(result.exitCode).toBe(1);
      expect(result.combined).toContain("MYSTERY_CODE");
      expect(result.combined).toContain("tr_123");
    });
  });
});
