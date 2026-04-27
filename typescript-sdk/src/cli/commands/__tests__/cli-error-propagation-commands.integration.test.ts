/**
 * Integration tests that spawn the real CLI binary and verify every
 * non-prompt command surfaces meaningful server-side error messages.
 *
 * This suite focuses on common failure modes (404/409/422/500 with
 * various payload shapes) so regressions in error propagation are caught
 * at the boundary the user actually experiences.
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
      setTimeout(() => child.kill("SIGKILL"), 1000);
    }, timeoutMs);

    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ combined: stdout + stderr, exitCode });
    });
  });
}

function makeTestDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "langwatch-cli-cmd-err-"));
}

describe("CLI error propagation across commands", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeTestDir();
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe("agent create", () => {
    it("surfaces a 409 conflict body to the user", async () => {
      pushResponse("POST", "/api/agents", {
        status: 409,
        body: {
          error: "Conflict",
          message: "Agent with that name already exists",
        },
      });

      const result = await runCli(
        ["agent", "create", "my-agent", "--type", "http"],
        testDir,
      );

      expect(result.exitCode).toBe(1);
      expect(result.combined.toLowerCase()).toContain("already exists");
      expect(result.combined.toLowerCase()).not.toContain(
        "error: internal server error",
      );
    });
  });

  describe("dataset get", () => {
    it("maps a 404 to a specific 'not found' message with the id", async () => {
      pushResponse("GET", "/api/dataset/:slugOrId", {
        status: 404,
        body: { error: "NotFoundError", message: "Dataset not found" },
      });

      const result = await runCli(["dataset", "get", "missing"], testDir);

      expect(result.exitCode).toBe(1);
      expect(result.combined.toLowerCase()).toContain("not found");
      expect(result.combined).toContain("missing");
    });
  });

  describe("monitor create", () => {
    it("forwards a 422 validation error from the API", async () => {
      pushResponse("POST", "/api/monitors", {
        status: 422,
        body: {
          error: "ValidationError",
          message: "checkType must be a valid evaluator type",
        },
      });

      const result = await runCli(
        [
          "monitor",
          "create",
          "m1",
          "--check-type",
          "not-a-real-type",
        ],
        testDir,
      );

      expect(result.exitCode).toBe(1);
      expect(result.combined.toLowerCase()).toContain(
        "must be a valid evaluator type",
      );
    });
  });

  describe("secret create", () => {
    it("surfaces the raw body when the server omits error/message fields", async () => {
      pushResponse("POST", "/api/secrets", {
        status: 500,
        body: { code: "DB_DOWN", traceId: "abc-123" },
      });

      const result = await runCli(
        ["secret", "create", "MY_SECRET", "--value", "sekret"],
        testDir,
      );

      expect(result.exitCode).toBe(1);
      expect(result.combined).toContain("DB_DOWN");
      expect(result.combined).toContain("abc-123");
    });
  });

  describe("workflow run", () => {
    it("shows the specific error body, not a generic 500", async () => {
      pushResponse("POST", "/api/workflows/:id/run", {
        status: 500,
        body: {
          error: "Internal server error",
          message: "missing required input 'query'",
        },
      });

      const result = await runCli(
        ["workflow", "run", "wf_abc", "--input", '{"x":1}'],
        testDir,
      );

      expect(result.exitCode).toBe(1);
      expect(result.combined.toLowerCase()).toContain(
        "missing required input",
      );
    });
  });

  describe("scenario get", () => {
    it("includes the scenario id in the 'not found' message", async () => {
      pushResponse("GET", "/api/scenarios/:id", {
        status: 404,
        body: { error: "NotFoundError", message: "Scenario not found" },
      });

      const result = await runCli(["scenario", "get", "s_missing"], testDir);

      expect(result.exitCode).toBe(1);
      expect(result.combined.toLowerCase()).toContain("not found");
      expect(result.combined).toContain("s_missing");
    });
  });
});
