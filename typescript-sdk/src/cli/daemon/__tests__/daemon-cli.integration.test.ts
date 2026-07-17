/**
 * The end-to-end fidelity test: the REAL built CLI, running REAL commands
 * against a REAL HTTP server, once in-process and once through a real daemon,
 * asserting the two are indistinguishable.
 *
 * Everything else in the daemon test suite mocks something. This mocks nothing,
 * which is the only way to know that commander, chalk, ora, dotenv, the client
 * SDK and `process.exit` all behave the same inside a warm process as they do
 * in a cold one.
 *
 * Requires `pnpm build` (like the other CLI integration tests in this package).
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import type { AddressInfo } from "node:net";

const CLI_PATH = path.resolve(__dirname, "../../../../dist/cli/index.js");

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

let server: http.Server;
let endpoint = "";
let requestCount = 0;
let socketDir: string;
let workDir: string;

const run = (
  args: string[],
  env: Record<string, string> = {},
  cwd: string = workDir,
): Promise<RunResult> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd,
      // stdio: "pipe" is what makes this a non-TTY invocation — i.e. exactly the
      // shape of an agent's `bash` call, which is the only shape the daemon serves.
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        LANGWATCH_ENDPOINT: endpoint,
        LANGWATCH_API_KEY: "sk-daemon-e2e",
        LANGWATCH_CLI_CONFIG: path.join(socketDir, "config.json"),
        LANGWATCH_DAEMON_DIR: socketDir,
        // The daemon must be explicitly opted into per test, never auto-spawned
        // behind a test's back.
        LANGWATCH_NO_DAEMON: "1",
        LANGWATCH_DAEMON_NO_SPAWN: "1",
        ...env,
      },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("close", (exitCode) => resolve({ stdout, stderr, exitCode }));
  });

/** Run with the daemon path enabled. */
const runViaDaemon = (
  args: string[],
  env: Record<string, string> = {},
  cwd: string = workDir,
): Promise<RunResult> =>
  run(args, { ...env, LANGWATCH_NO_DAEMON: "0" }, cwd);

const daemonStatus = async (): Promise<{
  running: boolean;
  served?: number;
  pid?: number;
}> => {
  const result = await run(["daemon", "status", "--json"], {
    LANGWATCH_NO_DAEMON: "0",
  });
  return JSON.parse(result.stdout) as { running: boolean; served?: number };
};

const startDaemon = async (
  env: Record<string, string> = {},
): Promise<void> => {
  await run(["daemon", "start"], { LANGWATCH_NO_DAEMON: "0", ...env });
  // Poll the daemon's own status rather than sleeping: it is up when it answers.
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await daemonStatus()).running) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("daemon did not come up");
};

const stopDaemon = async (): Promise<void> => {
  await run(["daemon", "stop"], { LANGWATCH_NO_DAEMON: "0" });
};

describe("the CLI served by a daemon", () => {
  beforeAll(async () => {
    if (!fs.existsSync(CLI_PATH)) {
      throw new Error(
        `${CLI_PATH} is missing — run \`pnpm build\` before the integration tests.`,
      );
    }

    server = http.createServer((req, res) => {
      requestCount++;
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        if (req.url?.startsWith("/api/traces/search")) {
          res.end(
            JSON.stringify({
              traces: [],
              pagination: { totalHits: 0, pageSize: 25, pageOffset: 0 },
            }),
          );
          return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "not found" }));
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // A short socket dir: unix sockets cap out around 104 bytes of path, and the
    // macOS temp dir is already ~50 of them.
    socketDir = fs.mkdtempSync(path.join(os.tmpdir(), "lwd-"));
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lww-"));
  });

  afterAll(async () => {
    await stopDaemon();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(socketDir, { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await stopDaemon();
  });

  describe("given no daemon is running", () => {
    describe("when a command runs with the daemon path enabled", () => {
      it("behaves exactly as it does today", async () => {
        const inProcess = await run(["trace", "search", "--format", "json"]);
        const withDaemonEnabled = await runViaDaemon([
          "trace",
          "search",
          "--format",
          "json",
        ]);

        expect(withDaemonEnabled.exitCode).toBe(inProcess.exitCode);
        expect(withDaemonEnabled.stdout).toBe(inProcess.stdout);
        expect(withDaemonEnabled.stderr).toBe(inProcess.stderr);
      });

      it("does not mention the daemon to a user who never asked for one", async () => {
        const result = await runViaDaemon(["trace", "search"]);
        expect(result.stderr).not.toContain("daemon");
      });
    });
  });

  describe("given a running daemon", () => {
    describe("when a command succeeds", () => {
      it("produces byte-identical stdout, stderr and exit code", async () => {
        const inProcess = await run(["trace", "search", "--format", "json"]);

        await startDaemon();
        const served = await runViaDaemon(["trace", "search", "--format", "json"]);

        expect(served.exitCode).toBe(inProcess.exitCode);
        expect(served.stdout).toBe(inProcess.stdout);
        expect(served.stderr).toBe(inProcess.stderr);
      });

      it("actually serves it from the daemon", async () => {
        await startDaemon();
        await runViaDaemon(["trace", "search"]);

        const status = await daemonStatus();
        expect(status.running).toBe(true);
        expect(status.served).toBeGreaterThanOrEqual(1);
      });

      it("reaches the real API through the warm process", async () => {
        await startDaemon();
        const before = requestCount;

        await runViaDaemon(["trace", "search"]);

        expect(requestCount).toBeGreaterThan(before);
      });
    });

    describe("when a command exits non-zero", () => {
      it("reproduces the exit code and stderr of the in-process run", async () => {
        // No API key: checkApiKey() prints and calls process.exit(1) — the exact
        // mid-flight-exit path that a warm process has to reproduce.
        const noKey = { LANGWATCH_API_KEY: "" };

        const inProcess = await run(["trace", "search"], noKey);
        expect(inProcess.exitCode).toBe(1);

        await startDaemon();
        const served = await runViaDaemon(["trace", "search"], noKey);

        expect(served.exitCode).toBe(1);
        expect(served.stdout).toBe(inProcess.stdout);
        expect(served.stderr).toBe(inProcess.stderr);
      });
    });

    describe("when an unknown command is given", () => {
      it("reproduces commander's own error and exit code", async () => {
        const inProcess = await run(["definitely-not-a-command"]);
        expect(inProcess.exitCode).not.toBe(0);

        await startDaemon();
        const served = await runViaDaemon(["definitely-not-a-command"]);

        expect(served.exitCode).toBe(inProcess.exitCode);
        expect(served.stderr).toBe(inProcess.stderr);
      });
    });

    describe("when commands are fanned out concurrently", () => {
      it("serves them all correctly", async () => {
        await startDaemon();

        const results = await Promise.all([
          runViaDaemon(["trace", "search", "--format", "json"]),
          runViaDaemon(["trace", "search", "--format", "json"]),
          runViaDaemon(["trace", "search", "--format", "json"]),
          runViaDaemon(["trace", "search", "--format", "json"]),
        ]);

        for (const result of results) {
          expect(result.exitCode).toBe(0);
          expect(result.stdout).toContain('"traces": []');
        }
        expect((await daemonStatus()).served).toBeGreaterThanOrEqual(4);
      });
    });

    describe("when the caller runs from its own working directory", () => {
      it("resolves local files against the CALLER's cwd, not the daemon's", async () => {
        await startDaemon();

        // The daemon's own cwd is the home directory. A command that reads a
        // local file must still see the caller's.
        const callerDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-cwd-"));
        fs.writeFileSync(
          path.join(callerDir, "prompts.json"),
          JSON.stringify({ prompts: {} }),
        );

        const inProcess = await run(["prompt", "list", "--format", "json"], {}, callerDir);
        const served = await runViaDaemon(
          ["prompt", "list", "--format", "json"],
          {},
          callerDir,
        );

        expect(served.exitCode).toBe(inProcess.exitCode);
        expect(served.stdout).toBe(inProcess.stdout);

        fs.rmSync(callerDir, { recursive: true, force: true });
      });
    });

    describe("when a command that must never be served is run", () => {
      it("runs `daemon status` in the caller's own process", async () => {
        await startDaemon();
        const before = (await daemonStatus()).served ?? 0;

        await runViaDaemon(["daemon", "status", "--json"]);

        // `daemon status` itself must not be counted as a served command, or it
        // would have gone through the daemon it is inspecting.
        expect((await daemonStatus()).served).toBe(before);
      });
    });
  });

  describe("given a daemon for a different identity", () => {
    describe("when a command runs under another API key", () => {
      it("is not served by it — a warm daemon never serves a foreign identity", async () => {
        await startDaemon();
        const before = (await daemonStatus()).served ?? 0;

        const served = await runViaDaemon(["trace", "search", "--format", "json"], {
          LANGWATCH_API_KEY: "sk-somebody-else",
        });

        // The command still works — it just ran in its own process.
        expect(served.exitCode).toBe(0);
        expect(served.stdout).toContain('"traces": []');
        expect((await daemonStatus()).served ?? 0).toBe(before);
      });
    });
  });

  describe("given the user opted out", () => {
    describe("when LANGWATCH_NO_DAEMON is set", () => {
      it("never contacts a running daemon", async () => {
        await startDaemon();
        const before = (await daemonStatus()).served ?? 0;

        const result = await run(["trace", "search", "--format", "json"]);

        expect(result.exitCode).toBe(0);
        expect((await daemonStatus()).served ?? 0).toBe(before);
      });
    });
  });

  describe("given auto-spawn is enabled", () => {
    const autoSpawn = { LANGWATCH_NO_DAEMON: "0", LANGWATCH_DAEMON_NO_SPAWN: "0" };

    describe("when a one-off command is run", () => {
      it("does not leave a daemon behind", async () => {
        expect((await daemonStatus()).running).toBe(false);

        const result = await run(["trace", "search", "--format", "json"], autoSpawn);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('"traces": []');
        expect((await daemonStatus()).running).toBe(false);
      });
    });

    describe("when the CLI is called repeatedly, as an agent does", () => {
      it("runs each command in-process and leaves a daemon behind for the next one", async () => {
        const first = await run(["trace", "search", "--format", "json"], autoSpawn);
        const second = await run(["trace", "search", "--format", "json"], autoSpawn);

        // Neither command waited on the spawn — both behaved exactly as today.
        expect(first.exitCode).toBe(0);
        expect(second.exitCode).toBe(0);
        expect(second.stdout).toContain('"traces": []');

        for (let attempt = 0; attempt < 100; attempt++) {
          if ((await daemonStatus()).running) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect((await daemonStatus()).running).toBe(true);

        // ...and the NEXT command is served by it.
        await runViaDaemon(["trace", "search"]);
        expect((await daemonStatus()).served ?? 0).toBeGreaterThanOrEqual(1);
      });
    });
  });
});
