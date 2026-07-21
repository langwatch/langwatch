/**
 * Integration tests over a real Unix domain socket.
 *
 * The command executor is injected, so these drive the parts that must not
 * break — handshake, framing, identity, lifecycle, cancellation, fallback —
 * without commander or the network in the picture. The real CLI running through
 * a real daemon is covered by daemon-cli.integration.test.ts.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { Writable } from "node:stream";

import { execViaDaemon, requestStatus, requestStop } from "../client";
import { secureSocketFile, UntrustedSocketDirError } from "../identity";
import {
  cleanStaleSocket,
  createDaemonServer,
  DaemonAlreadyRunningError,
  isSocketAlive,
  type DaemonServer,
} from "../server";
import { encodeFrame, FrameDecoder, PROTOCOL_VERSION, type ClientFrame } from "../protocol";
import type { CommandExecution, CommandExecutor } from "../runner";
import { noopTelemetry, type DaemonTelemetry } from "../telemetry";

const CLI_VERSION = "9.9.9";
const BUILD = "9.9.9+1234-5678";
const FINGERPRINT = "fingerprint-identity-a";

const collector = (): { stream: Writable; text: () => string } => {
  const chunks: Buffer[] = [];
  return {
    stream: new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    }),
    text: () => Buffer.concat(chunks).toString(),
  };
};

/** An executor that just replays a scripted result. */
const scriptedExecutor =
  (
    script: (args: string[]) => {
      stdout?: string;
      stderr?: string;
      exitCode?: number;
      delayMs?: number;
    },
  ): CommandExecutor =>
  (request): CommandExecution => {
    const plan = script(request.args);
    let cancelled = false;
    let settle: ((code: number) => void) | undefined;

    const completed = new Promise<number>((resolve) => {
      settle = resolve;
      const emit = (): void => {
        if (cancelled) return;
        if (plan.stdout) request.sink("stdout", Buffer.from(plan.stdout));
        if (plan.stderr) request.sink("stderr", Buffer.from(plan.stderr));
        resolve(plan.exitCode ?? 0);
      };
      if (plan.delayMs) setTimeout(emit, plan.delayMs);
      else emit();
    });

    return {
      completed,
      cancel: (code) => {
        cancelled = true;
        settle?.(code);
      },
    };
  };

describe("daemon over a unix socket", () => {
  let dir: string;
  let socketPath: string;
  let server: DaemonServer | undefined;

  const startDaemon = async (
    overrides: Partial<Parameters<typeof createDaemonServer>[0]> = {},
  ): Promise<DaemonServer> => {
    const created = createDaemonServer({
      socketPath,
      socketDir: dir,
      fingerprint: FINGERPRINT,
      cliVersion: CLI_VERSION,
      build: BUILD,
      idleTimeoutMs: 60_000,
      executor: scriptedExecutor(() => ({ stdout: "ok\n" })),
      ...overrides,
    });
    await created.listen();
    server = created;
    return created;
  };

  const exec = async (
    args: string[],
    overrides: Partial<Parameters<typeof execViaDaemon>[0]> = {},
  ) => {
    const out = collector();
    const err = collector();
    const outcome = await execViaDaemon({
      socketPath,
      fingerprint: FINGERPRINT,
      cliVersion: CLI_VERSION,
      build: BUILD,
      args,
      cwd: dir,
      env: {},
      colorLevel: 0,
      stdout: out.stream,
      stderr: err.stream,
      ...overrides,
    });
    return { outcome, stdout: out.text(), stderr: err.text() };
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-d-"));
    socketPath = path.join(dir, "test.sock");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await server?.stop("stop-requested");
    server = undefined;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("given no daemon is running", () => {
    describe("when a command is dispatched", () => {
      it("reports that it was not served, so the CLI runs in-process", async () => {
        const { outcome, stdout } = await exec(["trace", "search"]);

        expect(outcome).toMatchObject({ served: false });
        expect(stdout).toBe("");
      });

      it("does not hang", async () => {
        const started = Date.now();
        await exec(["trace", "search"]);
        expect(Date.now() - started).toBeLessThan(2_000);
      });
    });
  });

  describe("given a stale socket left by a crashed daemon", () => {
    beforeEach(() => {
      fs.writeFileSync(socketPath, "corpse");
    });

    describe("when a command is dispatched", () => {
      it("falls back instead of hanging on the dead socket", async () => {
        const { outcome } = await exec(["trace", "search"]);
        expect(outcome).toMatchObject({ served: false });
      });
    });

    describe("when the stale socket is cleaned", () => {
      it("removes the file", async () => {
        expect(await cleanStaleSocket(socketPath)).toBe(true);
        expect(fs.existsSync(socketPath)).toBe(false);
      });

      it("lets a daemon bind on top of it", async () => {
        await startDaemon();
        const { outcome } = await exec(["trace", "search"]);
        expect(outcome).toEqual({ served: true, exitCode: 0 });
      });
    });
  });

  describe("given a live daemon", () => {
    describe("when it binds its socket", () => {
      it("creates it 0600, so no other local user can drive our credentials", async () => {
        await startDaemon();

        const mode = fs.statSync(socketPath).mode & 0o777;
        expect(mode.toString(8)).toBe("600");
      });

      it("refuses to start a second daemon on the same socket", async () => {
        await startDaemon();

        const second = createDaemonServer({
          socketPath,
          socketDir: dir,
          fingerprint: FINGERPRINT,
          cliVersion: CLI_VERSION,
          build: BUILD,
        });

        await expect(second.listen()).rejects.toBeInstanceOf(
          DaemonAlreadyRunningError,
        );
      });
    });

    describe("when a command succeeds", () => {
      it("delivers stdout and a zero exit code", async () => {
        await startDaemon({
          executor: scriptedExecutor(() => ({ stdout: '{"traces":[]}\n' })),
        });

        const { outcome, stdout } = await exec(["trace", "search", "--format", "json"]);

        expect(outcome).toEqual({ served: true, exitCode: 0 });
        expect(stdout).toBe('{"traces":[]}\n');
      });

      it("passes the caller's args through untouched", async () => {
        const seen: string[][] = [];
        await startDaemon({
          executor: scriptedExecutor((args) => {
            seen.push(args);
            return {};
          }),
        });

        await exec(["trace", "get", "trace-123", "--format", "json"]);

        expect(seen).toEqual([
          ["trace", "get", "trace-123", "--format", "json"],
        ]);
      });
    });

    describe("when a command fails", () => {
      it("delivers stderr and the non-zero exit code", async () => {
        await startDaemon({
          executor: scriptedExecutor(() => ({
            stderr: "Error: LANGWATCH_API_KEY not found.\n",
            exitCode: 1,
          })),
        });

        const { outcome, stdout, stderr } = await exec(["trace", "search"]);

        expect(outcome).toEqual({ served: true, exitCode: 1 });
        expect(stderr).toBe("Error: LANGWATCH_API_KEY not found.\n");
        expect(stdout).toBe("");
      });

      it("preserves an unusual exit code verbatim", async () => {
        await startDaemon({
          executor: scriptedExecutor(() => ({ exitCode: 42 })),
        });

        const { outcome } = await exec(["trace", "search"]);
        expect(outcome).toEqual({ served: true, exitCode: 42 });
      });
    });

    describe("when a command emits bytes that are not valid UTF-8", () => {
      it("delivers them unchanged", async () => {
        const raw = Buffer.from([0x00, 0xff, 0x80, 0x41]);
        await startDaemon({
          executor: (request): CommandExecution => {
            request.sink("stdout", raw);
            return { completed: Promise.resolve(0), cancel: () => undefined };
          },
        });

        const chunks: Buffer[] = [];
        const sink = new Writable({
          write(chunk: Buffer, _encoding, callback) {
            chunks.push(Buffer.from(chunk));
            callback();
          },
        });

        const outcome = await execViaDaemon({
          socketPath,
          fingerprint: FINGERPRINT,
          cliVersion: CLI_VERSION,
          build: BUILD,
          args: ["trace", "export"],
          cwd: dir,
          env: {},
          colorLevel: 0,
          stdout: sink,
          stderr: sink,
        });

        expect(outcome).toEqual({ served: true, exitCode: 0 });
        expect(Buffer.concat(chunks).equals(raw)).toBe(true);
      });
    });

    describe("when several commands are dispatched at once", () => {
      it("serves them concurrently, each with its own output and exit code", async () => {
        await startDaemon({
          executor: scriptedExecutor((args) => ({
            stdout: `out:${args[1]}\n`,
            exitCode: Number(args[1]),
            delayMs: 20,
          })),
        });

        const started = Date.now();
        const results = await Promise.all([
          exec(["cmd", "1"]),
          exec(["cmd", "2"]),
          exec(["cmd", "3"]),
          exec(["cmd", "4"]),
          exec(["cmd", "5"]),
        ]);
        const elapsed = Date.now() - started;

        results.forEach((result, index) => {
          const n = index + 1;
          expect(result.outcome).toEqual({ served: true, exitCode: n });
          expect(result.stdout).toBe(`out:${n}\n`);
        });

        // Serialised, five 20ms commands would take >=100ms. Concurrency is the
        // whole point: an agent fanning out must not be slower than five cold
        // processes running in parallel.
        expect(elapsed).toBeLessThan(100);
      });
    });

    describe("when the client asks for status", () => {
      it("reports pid, version and counters", async () => {
        await startDaemon({ idleTimeoutMs: 12_345 });
        await exec(["trace", "search"]);

        const status = await requestStatus(socketPath);

        expect(status).toMatchObject({
          pid: process.pid,
          cliVersion: CLI_VERSION,
          protocol: PROTOCOL_VERSION,
          socketPath,
          idleTimeoutMs: 12_345,
          served: 1,
          inflight: 0,
        });
      });
    });

    describe("when the client asks it to stop", () => {
      it("shuts down and removes its socket", async () => {
        const running = await startDaemon();

        expect(await requestStop(socketPath)).toBe(true);
        await running.closed();

        expect(fs.existsSync(socketPath)).toBe(false);
        expect(await requestStatus(socketPath)).toBeNull();
      });
    });
  });

  describe("given a daemon that has been idle", () => {
    describe("when the idle timeout elapses", () => {
      it("exits and removes its socket, so it can never leak", async () => {
        const running = await startDaemon({ idleTimeoutMs: 20 });

        await running.closed();

        expect(fs.existsSync(socketPath)).toBe(false);
      });

      it("flushes telemetry on the way out", async () => {
        const shutdown = vi.fn().mockResolvedValue(undefined);
        const daemonStopping = vi.fn();
        const telemetry: DaemonTelemetry = {
          ...noopTelemetry,
          shutdown,
          daemonStopping,
        };

        const running = await startDaemon({ idleTimeoutMs: 20, telemetry });
        await running.closed();

        // The one place a persistent OTLP exporter would get to complete a
        // flush — which is precisely what a 200ms CLI process cannot do.
        expect(shutdown).toHaveBeenCalledOnce();
        expect(daemonStopping).toHaveBeenCalledWith(
          expect.objectContaining({ reason: "idle" }),
        );
      });

      it("does not fire while a command is still in flight", async () => {
        const running = await startDaemon({
          idleTimeoutMs: 30,
          executor: scriptedExecutor(() => ({
            stdout: "slow\n",
            delayMs: 90,
          })),
        });

        const { outcome, stdout } = await exec(["slow"]);

        expect(outcome).toEqual({ served: true, exitCode: 0 });
        expect(stdout).toBe("slow\n");

        // ...and only then does the idle clock start.
        await running.closed();
        expect(fs.existsSync(socketPath)).toBe(false);
      });
    });
  });

  describe("given a daemon running a different build of the CLI", () => {
    describe("when a newer client connects", () => {
      it("refuses the handshake rather than silently serving old behaviour", async () => {
        await startDaemon({ cliVersion: "0.1.0", build: "0.1.0+1-1" });

        const { outcome, stdout } = await exec(["trace", "search"]);

        expect(outcome).toMatchObject({
          served: false,
          reason: "handshake-refused:version-skew",
          evict: true,
        });
        expect(stdout).toBe("");
      });

      it("can then be evicted, leaving a clean socket for a fresh daemon", async () => {
        const stale = await startDaemon({ cliVersion: "0.1.0", build: "0.1.0+1-1" });

        await exec(["trace", "search"]);
        expect(await requestStop(socketPath)).toBe(true);
        await stale.closed();

        expect(fs.existsSync(socketPath)).toBe(false);
      });
    });
  });

  describe("given a daemon speaking a different protocol", () => {
    describe("when a client connects", () => {
      it("refuses the handshake", async () => {
        await startDaemon();

        // Hand-rolled client sending a bad protocol version.
        const refusal = await new Promise<string>((resolve) => {
          const socket = net.connect(socketPath, () => {
            socket.write(
              encodeFrame({
                t: "hello",
                protocol: PROTOCOL_VERSION + 1,
                cliVersion: CLI_VERSION,
                build: BUILD,
                fingerprint: FINGERPRINT,
              } satisfies ClientFrame),
            );
          });
          const decoder = new FrameDecoder();
          socket.on("data", (chunk: Buffer) => {
            for (const frame of decoder.push(chunk)) {
              if (frame.t === "hello-err") {
                socket.destroy();
                resolve(frame.reason);
              }
            }
          });
        });

        expect(refusal).toBe("protocol-skew");
      });
    });
  });

  describe("given a daemon warm for identity A", () => {
    describe("when identity B presents its fingerprint", () => {
      it("is refused, so A's credentials can never serve B's request", async () => {
        const executor = vi.fn(scriptedExecutor(() => ({ stdout: "leaked\n" })));
        await startDaemon({ executor });

        const { outcome, stdout } = await exec(["trace", "search"], {
          fingerprint: "fingerprint-identity-b",
        });

        expect(outcome).toMatchObject({
          served: false,
          reason: "handshake-refused:identity-mismatch",
        });
        expect(stdout).toBe("");
        expect(executor).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a client that is interrupted", () => {
    describe("when it sends a cancel", () => {
      it("stops the command and settles the caller at 130", async () => {
        let cancelledWith: number | undefined;
        await startDaemon({
          executor: (request): CommandExecution => {
            let settle: ((code: number) => void) | undefined;
            const completed = new Promise<number>((resolve) => {
              settle = resolve;
              // A command that would otherwise run forever.
              setTimeout(() => {
                request.sink("stdout", Buffer.from("too late\n"));
                resolve(0);
              }, 5_000).unref();
            });
            return {
              completed,
              cancel: (code) => {
                cancelledWith = code;
                settle?.(code);
              },
            };
          },
        });

        const out = collector();
        const socket = net.connect(socketPath);
        const decoder = new FrameDecoder();

        const exitCode = await new Promise<number>((resolve) => {
          socket.on("connect", () => {
            socket.write(
              encodeFrame({
                t: "hello",
                protocol: PROTOCOL_VERSION,
                cliVersion: CLI_VERSION,
                build: BUILD,
                fingerprint: FINGERPRINT,
              }),
            );
            socket.write(
              encodeFrame({
                t: "exec",
                args: ["forever"],
                cwd: dir,
                env: {},
                colorLevel: 0,
              }),
            );
          });
          socket.on("data", (chunk: Buffer) => {
            for (const frame of decoder.push(chunk)) {
              if (frame.t === "hello-ok") {
                socket.write(encodeFrame({ t: "cancel" }));
              }
              if (frame.t === "out") {
                out.stream.write(Buffer.from(frame.d, "base64"));
              }
              if (frame.t === "exit") {
                socket.destroy();
                resolve(frame.code);
              }
            }
          });
        });

        expect(exitCode).toBe(130);
        expect(cancelledWith).toBe(130);
        expect(out.text()).toBe("");
      });
    });

    describe("when the client vanishes without saying anything", () => {
      it("cancels the orphaned command rather than leaving it running", async () => {
        let cancelled = false;
        await startDaemon({
          executor: (): CommandExecution => ({
            completed: new Promise<number>(() => undefined),
            cancel: () => {
              cancelled = true;
            },
          }),
        });

        const socket = net.connect(socketPath);
        await new Promise<void>((resolve) => {
          socket.on("connect", () => {
            socket.write(
              encodeFrame({
                t: "hello",
                protocol: PROTOCOL_VERSION,
                cliVersion: CLI_VERSION,
                build: BUILD,
                fingerprint: FINGERPRINT,
              }),
            );
            socket.write(
              encodeFrame({
                t: "exec",
                args: ["forever"],
                cwd: dir,
                env: {},
                colorLevel: 0,
              }),
            );
            resolve();
          });
        });

        // Simulate the shell killing the client.
        socket.destroy();
        await vi.waitFor(() => expect(cancelled).toBe(true));
      });
    });
  });

  /**
   * The daemon's whole trust model is filesystem permissions. The server half
   * (0600 socket in a 0700 directory) is worthless if the CLIENT will talk to
   * any socket at that path — it pipelines `exec` before the handshake is
   * answered, so a squatter is handed the caller's args, cwd and forwarded
   * LANGWATCH_* env, API key included.
   */
  describe("given a socket the caller cannot trust", () => {
    describe("when its directory is writable by other users", () => {
      it("refuses to connect and reports not-served, so the CLI runs in-process", async () => {
        const executor = vi.fn(scriptedExecutor(() => ({ stdout: "leaked\n" })));
        await startDaemon({ executor });

        // Anyone who can write the directory can unlink our socket and bind
        // their own in its place.
        fs.chmodSync(dir, 0o777);

        const { outcome, stdout } = await exec(["trace", "search"]);

        expect(outcome).toEqual({
          served: false,
          reason: "socket-dir-loose-mode",
        });
        expect(stdout).toBe("");
        expect(executor).not.toHaveBeenCalled();
      });
    });

    describe("when the socket itself is world-connectable", () => {
      it("refuses it rather than drive a daemon anyone else can drive too", async () => {
        const executor = vi.fn(scriptedExecutor(() => ({ stdout: "leaked\n" })));
        await startDaemon({ executor });

        fs.chmodSync(socketPath, 0o666);

        const { outcome } = await exec(["trace", "search"]);

        expect(outcome).toEqual({ served: false, reason: "socket-loose-mode" });
        expect(executor).not.toHaveBeenCalled();
      });
    });

    describe("when it is owned by another user", () => {
      it("refuses it, and reports no daemon for status and stop as well", async () => {
        const executor = vi.fn(scriptedExecutor(() => ({ stdout: "leaked\n" })));
        await startDaemon({ executor });

        // chown needs root; moving OUR uid makes the same comparison fail.
        vi.spyOn(process, "getuid").mockReturnValue(
          (process.getuid?.() ?? 0) + 1,
        );

        const { outcome, stdout } = await exec(["trace", "search"]);

        expect(outcome).toEqual({
          served: false,
          reason: "socket-dir-foreign-owner",
        });
        expect(stdout).toBe("");
        expect(executor).not.toHaveBeenCalled();
        // A stranger's listener is not our daemon: nothing to report, and
        // nothing to send an unauthenticated `stop` to.
        expect(await requestStatus(socketPath)).toBeNull();
        expect(await requestStop(socketPath)).toBe(false);

        vi.restoreAllMocks();
      });
    });
  });

  describe("given somebody else already holds the socket path", () => {
    describe("when the real daemon tries to start", () => {
      it("names the squat instead of reporting a daemon that is already running", async () => {
        // The DoS the trust check has to prevent. `isSocketAlive` used to
        // connect blind, so a squatter binding the path first — reachable via
        // LANGWATCH_DAEMON_DIR, XDG_RUNTIME_DIR or the tmp fallback — made
        // `listen()` throw DaemonAlreadyRunningError, forever. Nothing is
        // disclosed (no bytes are sent), but the daemon could never start again
        // and nothing would ever say why: a permanent, silent denial of service.
        // A stranger's listener, bound to our socket path first.
        const squatter = net.createServer();
        await new Promise<void>((resolve) =>
          squatter.listen(socketPath, resolve),
        );
        secureSocketFile(socketPath);

        // chown needs root; moving OUR uid makes the same comparison fail.
        vi.spyOn(process, "getuid").mockReturnValue(
          (process.getuid?.() ?? 0) + 1,
        );

        // A foreign socket is not "alive", because it is not ours...
        expect(await isSocketAlive(socketPath)).toBe(false);

        // ...and starting reports the actual problem, actionably.
        const created = createDaemonServer({
          socketPath,
          socketDir: dir,
          fingerprint: FINGERPRINT,
          cliVersion: CLI_VERSION,
          build: BUILD,
          idleTimeoutMs: 60_000,
          executor: scriptedExecutor(() => ({ stdout: "ok\n" })),
        });

        const failure = await created.listen().catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(UntrustedSocketDirError);
        // The distinction that matters: NOT "already running", which is the
        // misdiagnosis no amount of restarting could ever clear.
        expect(failure).not.toBeInstanceOf(DaemonAlreadyRunningError);
        // (`ensureSocketDir` is what fires here — under a foreign uid the
        // containing directory fails first. The socket-level check in
        // `listen()` covers the narrower window where the directory was
        // repaired but the squatter's socket file survived inside it.)
        expect((failure as Error).message).toContain("owned by another user");

        vi.restoreAllMocks();
        await new Promise<void>((resolve) => squatter.close(() => resolve()));
      });
    });
  });

  describe("given a daemon asked to stop while it is still serving", () => {
    describe("when a request is in flight", () => {
      it("waits for it before tearing the execution window down", async () => {
        // What actually goes wrong without the drain is NOT a missing exit
        // frame — the frame still arrives, and the client still reports exit 0.
        // It is that `window.reset()` restores the daemon's OWN cwd and
        // environment underneath a command that has not finished, so the
        // command resolves its remaining paths and reads its credentials
        // against the wrong globals and then reports a status the client
        // trusts. That is invisible to the transcript, so the transcript is not
        // what this asserts on: the executor records what it SEES at the moment
        // it completes, the way `resumableProgram` does in the runner tests.
        const seen: { cwd?: string; token?: string } = {};
        const savedCwd = process.cwd();
        const callerCwd = fs.realpathSync(dir);

        const running = await startDaemon({
          shutdownGraceMs: 5_000,
          executor: (request): CommandExecution => {
            // Stand in for ExecutionWindow.applyWindow, which the real executor
            // would have run: put the process into the caller's window.
            process.chdir(request.cwd);
            process.env.LW_TEST_WINDOW_TOKEN = "caller";
            return {
              completed: new Promise<number>((resolve) => {
                setTimeout(() => {
                  seen.cwd = process.cwd();
                  seen.token = process.env.LW_TEST_WINDOW_TOKEN;
                  request.sink("stdout", Buffer.from("finished\n"));
                  resolve(0);
                }, 60);
              }),
              cancel: () => undefined,
            };
          },
        });

        const inFlight = exec(["slow"]);
        // Let the exec frame land so the request is genuinely counted.
        await vi.waitFor(() => expect(running.stats().inflight).toBe(1));

        await running.stop("stop-requested");

        // Version-skew eviction makes this a routine dev-loop event; the
        // request must not finish against the daemon's restored globals.
        expect(running.stats().inflight).toBe(0);

        const { outcome, stdout } = await inFlight;
        expect(outcome).toEqual({ served: true, exitCode: 0 });
        expect(stdout).toBe("finished\n");

        // The load-bearing assertions: the command finished inside its OWN
        // window, not the daemon's restored one.
        expect(seen.cwd).toBe(callerCwd);
        expect(seen.token).toBe("caller");

        process.chdir(savedCwd);
        delete process.env.LW_TEST_WINDOW_TOKEN;
      });
    });

    describe("when the in-flight request will not finish in time", () => {
      it("cuts the connection so the client falls back instead of trusting the result", async () => {
        const running = await startDaemon({
          shutdownGraceMs: 30,
          executor: (): CommandExecution => ({
            completed: new Promise<number>(() => undefined),
            cancel: () => undefined,
          }),
        });

        const inFlight = exec(["forever"]);
        await vi.waitFor(() => expect(running.stats().inflight).toBe(1));

        await running.stop("stop-requested");

        // No `exit` frame ever reached the client, and nothing was committed to
        // its stdout, so re-running in-process is safe and correct.
        const { outcome, stdout } = await inFlight;
        expect(outcome).toMatchObject({ served: false });
        expect(stdout).toBe("");
      });
    });

    describe("when the in-flight request has already flushed output to the caller", () => {
      it("reports the truncation honestly instead of pretending it can re-run", async () => {
        // The case the drain-timeout guarantee does NOT cover. Once output
        // crosses the client's buffer cap it is on the caller's real stdout,
        // so the clean in-process re-run is off the table — re-running would
        // print it twice. `trace search`, `analytics query` and any large
        // `--format json` land here, and routine version-skew eviction
        // (dispatch.ts requestStop) is what triggers it.
        const running = await startDaemon({
          shutdownGraceMs: 30,
          executor: (request): CommandExecution => {
            request.sink("stdout", Buffer.from("partial results\n"));
            return {
              completed: new Promise<number>(() => undefined),
              cancel: () => undefined,
            };
          },
        });

        const out = collector();
        const err = collector();
        const inFlight = execViaDaemon({
          socketPath,
          fingerprint: FINGERPRINT,
          cliVersion: CLI_VERSION,
          build: BUILD,
          args: ["trace", "search"],
          cwd: dir,
          env: {},
          colorLevel: 0,
          // Commit on the first byte, as a real large-output command would.
          maxBufferBytes: 1,
          stdout: out.stream,
          stderr: err.stream,
        });
        await vi.waitFor(() => expect(running.stats().inflight).toBe(1));

        await running.stop("stop-requested");

        // NOT `served: false`: a re-run would duplicate what is already printed.
        expect(await inFlight).toEqual({ served: true, exitCode: 1 });
        expect(out.text()).toBe("partial results\n");
        // And the caller is told plainly that both halves of what they got are
        // untrustworthy — the output is cut short, and the status is ours.
        expect(err.text()).toContain("incomplete");
        expect(err.text()).toContain("not the command's");
      });
    });
  });

  describe("given a daemon that declines the request", () => {
    describe("when the caller's working directory no longer exists", () => {
      it("tells the client to run it in-process, having emitted no output", async () => {
        await startDaemon({
          executor: (): CommandExecution => ({
            completed: Promise.reject(
              new Error("ENOENT: no such file or directory, chdir"),
            ),
            cancel: () => undefined,
          }),
        });

        const { outcome, stdout } = await exec(["trace", "search"]);

        expect(outcome).toMatchObject({ served: false });
        expect((outcome as { reason: string }).reason).toContain(
          "daemon-declined",
        );
        expect(stdout).toBe("");
      });
    });
  });
});

describe("given a daemon that dies mid-command", () => {
  let dir: string;
  let socketPath: string;
  let rogue: net.Server;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-rogue-"));
    socketPath = path.join(dir, "rogue.sock");
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => rogue.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A "daemon" that handshakes, optionally emits, then drops the connection. */
  const startRogue = async (emitBeforeDying: string | null): Promise<void> => {
    rogue = net.createServer((socket) => {
      const decoder = new FrameDecoder<ClientFrame>();
      socket.on("data", (chunk: Buffer) => {
        for (const frame of decoder.push(chunk)) {
          if (frame.t === "hello") {
            socket.write(
              encodeFrame({
                t: "hello-ok",
                protocol: PROTOCOL_VERSION,
                cliVersion: CLI_VERSION,
                build: BUILD,
                pid: 1,
              }),
            );
          }
          if (frame.t === "exec") {
            if (emitBeforeDying !== null) {
              socket.write(
                encodeFrame({
                  t: "out",
                  d: Buffer.from(emitBeforeDying).toString("base64"),
                }),
              );
            }
            setImmediate(() => socket.destroy());
          }
        }
      });
    });
    await new Promise<void>((resolve) => rogue.listen(socketPath, resolve));
    // A real daemon tightens its socket to 0600 the moment it binds; the client
    // will not talk to one that has not (see inspectSocketTrust), so the rogue
    // has to look like a genuine daemon for these tests to exercise the
    // mid-command death they are actually about.
    secureSocketFile(socketPath);
  };

  describe("when it dies before any output reaches the caller", () => {
    it("reports not-served, so the CLI reruns in-process with no duplicate output", async () => {
      await startRogue(null);
      const out = collector();

      const outcome = await execViaDaemon({
        socketPath,
        fingerprint: FINGERPRINT,
        cliVersion: CLI_VERSION,
        build: BUILD,
        args: ["trace", "search"],
        cwd: dir,
        env: {},
        colorLevel: 0,
        stdout: out.stream,
        stderr: out.stream,
      });

      expect(outcome).toMatchObject({ served: false });
      expect(out.text()).toBe("");
    });
  });

  describe("when it dies after output was buffered but never committed", () => {
    it("discards the partial output rather than half-printing it", async () => {
      await startRogue("partial output that must not be printed\n");
      const out = collector();

      const outcome = await execViaDaemon({
        socketPath,
        fingerprint: FINGERPRINT,
        cliVersion: CLI_VERSION,
        build: BUILD,
        args: ["trace", "search"],
        cwd: dir,
        env: {},
        colorLevel: 0,
        stdout: out.stream,
        stderr: out.stream,
      });

      expect(outcome).toMatchObject({ served: false });
      expect(out.text()).toBe("");
    });
  });

  describe("when it dies after output was already flushed to the caller", () => {
    it("does not silently rerun, because that would print the output twice", async () => {
      await startRogue("streamed\n");
      const out = collector();
      const err = collector();

      const outcome = await execViaDaemon({
        socketPath,
        fingerprint: FINGERPRINT,
        cliVersion: CLI_VERSION,
        build: BUILD,
        args: ["trace", "export"],
        cwd: dir,
        env: {},
        colorLevel: 0,
        // Force the commit threshold to be crossed immediately.
        maxBufferBytes: 1,
        stdout: out.stream,
        stderr: err.stream,
      });

      expect(outcome).toEqual({ served: true, exitCode: 1 });
      expect(out.text()).toBe("streamed\n");
      expect(err.text()).toContain("daemon");
    });
  });
});
