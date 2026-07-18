import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { Console } from "node:console";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import chalk from "chalk";

import { disableOutputColor } from "../../utils/errorOutput";
import {
  ExecutionContext,
  ExecutionWindow,
  installProcessInterceptors,
  isDaemonExitSignal,
  withExecutionContext,
  type OutputStream,
} from "../execution";

const collectingSink = (): {
  sink: (stream: OutputStream, chunk: Buffer) => void;
  stdout: () => string;
  stderr: () => string;
} => {
  const chunks: { stream: OutputStream; data: Buffer }[] = [];
  return {
    sink: (stream, data) => chunks.push({ stream, data }),
    stdout: () =>
      Buffer.concat(
        chunks.filter((c) => c.stream === "stdout").map((c) => c.data),
      ).toString(),
    stderr: () =>
      Buffer.concat(
        chunks.filter((c) => c.stream === "stderr").map((c) => c.data),
      ).toString(),
  };
};

describe("ExecutionContext", () => {
  describe("when a command exits mid-flight", () => {
    it("keeps the output produced before the exit", () => {
      const { sink, stdout } = collectingSink();
      const context = new ExecutionContext("r1", sink);

      context.write("stdout", Buffer.from("before\n"));
      context.finalize(2);

      expect(stdout()).toBe("before\n");
      expect(context.exitCode).toBe(2);
    });

    it("drops output written by the unwinding stack afterwards", () => {
      const { sink, stderr } = collectingSink();
      const context = new ExecutionContext("r1", sink);

      context.finalize(1);
      // This is what an enclosing `catch (e) { console.error(e) }` would emit
      // after checkApiKey() called process.exit(1). A real process would
      // already be dead and would print none of it.
      context.write("stderr", Buffer.from("Error: process.exit(1)\n"));

      expect(stderr()).toBe("");
    });

    it("keeps the FIRST exit code, as process termination would", () => {
      const { sink } = collectingSink();
      const context = new ExecutionContext("r1", sink);

      context.finalize(3);
      context.finalize(1);

      expect(context.exitCode).toBe(3);
    });
  });

  describe("given a command that never exits explicitly", () => {
    it("reports success", () => {
      const { sink } = collectingSink();
      expect(new ExecutionContext("r1", sink).exitCode).toBe(0);
    });
  });
});

describe("process interceptors", () => {
  let uninstall: () => void;
  /**
   * Node's global `console` writes through `process.stdout.write`, which is
   * exactly the seam the daemon patches. Vitest, however, swaps `globalThis
   * .console` for its own reporter-bound Console, so calling `console.log` here
   * would test vitest rather than the daemon. A Console constructed over
   * process.stdout/stderr is what the CLI actually has at runtime, so that is
   * what these tests drive. The end-to-end fidelity of the real global console
   * is covered by daemon-cli.integration.test.ts, which runs the real binary.
   */
  let cliConsole: Console;

  beforeEach(() => {
    uninstall = installProcessInterceptors();
    cliConsole = new Console({
      stdout: process.stdout,
      stderr: process.stderr,
    });
  });

  afterEach(() => {
    uninstall();
  });

  describe("when a command writes to stdout inside a request", () => {
    it("routes console output to that request, not to the daemon's stdout", () => {
      const { sink, stdout } = collectingSink();
      const context = new ExecutionContext("r1", sink);

      withExecutionContext(context, () => {
        cliConsole.log("hello from the command");
      });

      expect(stdout()).toBe("hello from the command\n");
    });

    it("routes output produced after an await to the same request", async () => {
      const { sink, stdout } = collectingSink();
      const context = new ExecutionContext("r1", sink);

      await withExecutionContext(context, async () => {
        cliConsole.log("before await");
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 1));
        cliConsole.log("after await");
      });

      expect(stdout()).toBe("before await\nafter await\n");
    });
  });

  describe("when two requests run concurrently", () => {
    it("gives each caller only its own output", async () => {
      const first = collectingSink();
      const second = collectingSink();

      await Promise.all([
        withExecutionContext(new ExecutionContext("a", first.sink), async () => {
          cliConsole.log("a1");
          await new Promise((resolve) => setTimeout(resolve, 5));
          cliConsole.log("a2");
        }),
        withExecutionContext(new ExecutionContext("b", second.sink), async () => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          cliConsole.log("b1");
          cliConsole.error("b-err");
        }),
      ]);

      expect(first.stdout()).toBe("a1\na2\n");
      expect(second.stdout()).toBe("b1\n");
      expect(second.stderr()).toBe("b-err\n");
      expect(first.stderr()).toBe("");
    });

    it("strips colour from a colour-off request only, without touching chalk.level", async () => {
      // Agent mode turns colour off per request (utils/errorOutput.ts
      // disableOutputColor). chalk.level is process-global, so the daemon
      // strips that request's SGR sequences at the sink instead of mutating
      // it — a concurrent human caller keeps its colour.
      const savedLevel = chalk.level;
      try {
        chalk.level = 1;
        const agent = collectingSink();
        const human = collectingSink();

        await Promise.all([
          withExecutionContext(new ExecutionContext("agent", agent.sink), async () => {
            disableOutputColor();
            cliConsole.error(chalk.red("agent error"));
            await new Promise((resolve) => setTimeout(resolve, 5));
            cliConsole.error(chalk.red("agent later"));
          }),
          withExecutionContext(new ExecutionContext("human", human.sink), async () => {
            await new Promise((resolve) => setTimeout(resolve, 1));
            cliConsole.error(chalk.red("human error"));
          }),
        ]);

        expect(agent.stderr()).toBe("agent error\nagent later\n");
        expect(human.stderr()).toBe("\u001B[31mhuman error\u001B[39m\n");
        expect(chalk.level).toBe(1);
      } finally {
        chalk.level = savedLevel;
      }
    });

    it("strips a colour sequence split across two writes", async () => {
      const savedLevel = chalk.level;
      try {
        chalk.level = 1;
        const agent = collectingSink();
        const context = new ExecutionContext("agent", agent.sink);

        await withExecutionContext(context, async () => {
          disableOutputColor();
          // The ESC[3 of one write and the 1m of the next are one SGR
          // sequence; per-chunk stripping alone would leak both halves.
          context.write("stderr", Buffer.from("\u001B[3"));
          context.write("stderr", Buffer.from("1mred error\u001B[39m\n"));
        });

        expect(agent.stderr()).toBe("red error\n");
      } finally {
        chalk.level = savedLevel;
      }
    });
  });

  describe("when a command calls process.exit", () => {
    it("throws a signal carrying the code instead of killing the daemon", () => {
      const { sink } = collectingSink();
      const context = new ExecutionContext("r1", sink);

      const thrown = withExecutionContext(context, () => {
        try {
          process.exit(4);
        } catch (error) {
          return error;
        }
      });

      expect(isDaemonExitSignal(thrown)).toBe(true);
      expect(context.exitCode).toBe(4);
      expect(context.isFinished).toBe(true);
    });

    it("finalises before throwing, so a catch block cannot print over the exit", () => {
      const { sink, stderr } = collectingSink();
      const context = new ExecutionContext("r1", sink);

      withExecutionContext(context, () => {
        try {
          cliConsole.error("real error message");
          process.exit(1);
        } catch {
          // exactly the shape of the CLI's action wrappers
          cliConsole.error("Error: process.exit(1)");
        }
      });

      expect(stderr()).toBe("real error message\n");
    });
  });
});

describe("given a write made outside any request", () => {
  describe("when the daemon logs for itself", () => {
    it("passes the write through to the real stream", () => {
      const underlying = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);
      // Install AFTER spying, so the interceptor captures the spy as the real
      // stream and we can observe the pass-through.
      const uninstall = installProcessInterceptors();

      process.stdout.write("daemon's own log line\n");

      expect(underlying).toHaveBeenCalledWith(
        "daemon's own log line\n",
        undefined,
        undefined,
      );

      uninstall();
      underlying.mockRestore();
    });
  });
});

describe("ExecutionWindow", () => {
  let window: ExecutionWindow;
  let dirA: string;
  let dirB: string;
  const savedCwd = process.cwd();

  beforeEach(() => {
    dirA = fs.mkdtempSync(path.join(os.tmpdir(), "lw-win-a-"));
    dirB = fs.mkdtempSync(path.join(os.tmpdir(), "lw-win-b-"));
    window = new ExecutionWindow();
  });

  afterEach(() => {
    window.reset();
    process.chdir(savedCwd);
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  });

  describe("when a request arrives", () => {
    it("runs it in the CALLER's working directory, not the daemon's", async () => {
      const release = await window.acquire({
        cwd: dirA,
        env: {},
        colorLevel: 0,
      });

      expect(fs.realpathSync(process.cwd())).toBe(fs.realpathSync(dirA));
      release();
    });

    it("applies the caller's env overlay", async () => {
      const release = await window.acquire({
        cwd: dirA,
        env: { LANGWATCH_API_KEY: "sk-caller" },
        colorLevel: 0,
      });

      expect(process.env.LANGWATCH_API_KEY).toBe("sk-caller");
      release();
    });

    it("hides a LANGWATCH_* variable the daemon has but the caller does not", async () => {
      process.env.LANGWATCH_LEAKED = "from-daemon-boot";
      const scoped = new ExecutionWindow();
      delete process.env.LANGWATCH_LEAKED;

      const release = await scoped.acquire({
        cwd: dirA,
        env: { LANGWATCH_API_KEY: "sk-caller" },
        colorLevel: 0,
      });

      expect(process.env.LANGWATCH_LEAKED).toBeUndefined();
      release();
      scoped.reset();
      delete process.env.LANGWATCH_LEAKED;
    });

    it("hides an agent-mode env var the daemon inherited but the caller did not send", async () => {
      // A daemon auto-spawned BY an agent boots with e.g. CLAUDECODE=1 in its
      // baseline. A later HUMAN caller must not be misread as an agent.
      const saved = process.env.CLAUDECODE;
      try {
        process.env.CLAUDECODE = "1";
        const scoped = new ExecutionWindow();
        delete process.env.CLAUDECODE;

        const release = await scoped.acquire({
          cwd: dirA,
          env: {},
          colorLevel: 0,
        });

        expect(process.env.CLAUDECODE).toBeUndefined();
        release();
        scoped.reset();
      } finally {
        if (saved === undefined) delete process.env.CLAUDECODE;
        else process.env.CLAUDECODE = saved;
      }
    });

    it("keeps an agent-mode env var the caller DID send", async () => {
      const saved = process.env.CLAUDECODE;
      try {
        const scoped = new ExecutionWindow();

        const release = await scoped.acquire({
          cwd: dirA,
          env: { CLAUDECODE: "1" },
          colorLevel: 0,
        });

        expect(process.env.CLAUDECODE).toBe("1");
        release();
        scoped.reset();
      } finally {
        if (saved === undefined) delete process.env.CLAUDECODE;
        else process.env.CLAUDECODE = saved;
      }
    });

    it("re-applies the caller's colour level when the window key is unchanged", async () => {
      // Agent mode (`--agent`) turns colour off mid-request — see
      // applyOutputContext — without that being part of the window key, so a
      // reused window would otherwise keep the previous caller's level.
      const savedLevel = chalk.level;
      try {
        const first = await window.acquire({ cwd: dirA, env: {}, colorLevel: 3 });
        expect(chalk.level).toBe(3);

        chalk.level = 0; // what the just-finished --agent request left behind
        first();

        const second = await window.acquire({ cwd: dirA, env: {}, colorLevel: 3 });
        expect(chalk.level).toBe(3);
        second();
      } finally {
        chalk.level = savedLevel;
      }
    });
  });

  describe("when requests share a working directory and environment", () => {
    it("runs them concurrently rather than queueing them", async () => {
      const request = { cwd: dirA, env: {}, colorLevel: 0 };

      const first = await window.acquire(request);
      const second = await window.acquire(request);

      expect(window.inflightCount).toBe(2);
      expect(window.queuedCount).toBe(0);

      first();
      second();
    });
  });

  describe("when requests disagree about the working directory", () => {
    it("makes the second wait until the first drains, then switches the globals", async () => {
      const releaseA = await window.acquire({
        cwd: dirA,
        env: {},
        colorLevel: 0,
      });

      let admitted = false;
      const pendingB = window
        .acquire({ cwd: dirB, env: {}, colorLevel: 0 })
        .then((release) => {
          admitted = true;
          return release;
        });

      await Promise.resolve();
      expect(admitted).toBe(false);
      expect(window.queuedCount).toBe(1);
      expect(fs.realpathSync(process.cwd())).toBe(fs.realpathSync(dirA));

      releaseA();
      const releaseB = await pendingB;

      expect(admitted).toBe(true);
      expect(fs.realpathSync(process.cwd())).toBe(fs.realpathSync(dirB));
      releaseB();
    });

    it("does not let a stream of same-window requests starve a waiting one", async () => {
      const releaseA = await window.acquire({
        cwd: dirA,
        env: {},
        colorLevel: 0,
      });

      const pendingB = window.acquire({ cwd: dirB, env: {}, colorLevel: 0 });
      // Arrives after B, but matches the ACTIVE window. It must not jump B.
      const pendingA2 = window.acquire({ cwd: dirA, env: {}, colorLevel: 0 });

      await Promise.resolve();
      expect(window.queuedCount).toBe(2);

      releaseA();
      const releaseB = await pendingB;
      expect(fs.realpathSync(process.cwd())).toBe(fs.realpathSync(dirB));

      releaseB();
      const releaseA2 = await pendingA2;
      expect(fs.realpathSync(process.cwd())).toBe(fs.realpathSync(dirA));
      releaseA2();
    });
  });

  describe("when a queued request is aborted before admission", () => {
    it("leaves the queue instead of being admitted after its caller is gone", async () => {
      // A hung window-A command (or a slow one) makes window-B callers queue.
      // If such a caller is cancelled or times out while waiting, admitting it
      // later would wedge the window: nobody is left to release it.
      const releaseA = await window.acquire({
        cwd: dirA,
        env: {},
        colorLevel: 0,
      });

      const controller = new AbortController();
      const pendingB = window.acquire(
        { cwd: dirB, env: {}, colorLevel: 0 },
        controller.signal,
      );

      await Promise.resolve();
      expect(window.queuedCount).toBe(1);

      controller.abort();
      await expect(pendingB).rejects.toThrow(/cancelled/);
      expect(window.queuedCount).toBe(0);

      // The window still drains correctly for the next caller.
      releaseA();
      const releaseB = await window.acquire({ cwd: dirB, env: {}, colorLevel: 0 });
      expect(fs.realpathSync(process.cwd())).toBe(fs.realpathSync(dirB));
      releaseB();
    });
  });

  describe("when the caller's working directory has been deleted", () => {
    it("rejects, so the client can run the command itself", async () => {
      const doomed = fs.mkdtempSync(path.join(os.tmpdir(), "lw-win-gone-"));
      fs.rmSync(doomed, { recursive: true, force: true });

      await expect(
        window.acquire({ cwd: doomed, env: {}, colorLevel: 0 }),
      ).rejects.toThrow();
    });
  });
});
