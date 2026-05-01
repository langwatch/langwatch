import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { EventBus } from "../../src/services/event-bus.ts";
import { servicePaths } from "../../src/services/paths.ts";
import { supervise } from "../../src/services/spawn.ts";

function makePaths() {
  const root = mkdtempSync(join(tmpdir(), "lw-spawn-"));
  return {
    root,
    bin: join(root, "bin"),
    data: join(root, "data"),
    redisData: join(root, "data", "redis"),
    postgresData: join(root, "data", "postgres"),
    clickhouseData: join(root, "data", "clickhouse"),
    logs: join(root, "logs"),
    pidFile: join(root, "run", "langwatch.pid"),
    lockFile: join(root, "run", "langwatch.lock"),
    envFile: join(root, ".env"),
    installManifest: join(root, "install-manifest.json"),
  } as const;
}

describe("supervise", () => {
  let paths: ReturnType<typeof makePaths>;

  beforeEach(() => {
    paths = makePaths();
  });

  afterEach(() => {
    rmSync(paths.root, { recursive: true, force: true });
  });

  describe("when a child writes lines to stdout", () => {
    it("tees them to the per-service log file and emits log events", async () => {
      const bus = new EventBus();
      const sp = servicePaths(paths);
      const handle = supervise({
        spec: {
          name: "postgres",
          command: "node",
          args: [
            "-e",
            "console.log('row-1'); console.log('row-2'); setTimeout(() => process.exit(0), 50);",
          ],
          env: process.env,
        },
        paths: sp,
        bus,
      });

      const events: string[] = [];
      const it = bus[Symbol.asyncIterator]();
      const collect = (async () => {
        while (true) {
          const r = await it.next();
          if (r.done) return;
          if (r.value.type === "log") events.push(r.value.line);
          if (r.value.type === "stopped") return;
        }
      })();
      await collect;

      const log = readFileSync(sp.log("postgres"), "utf8");
      expect(log).toContain("row-1");
      expect(log).toContain("row-2");
      expect(events).toContain("row-1");
      expect(events).toContain("row-2");
      expect(handle.pid).toBeGreaterThan(0);
    });
  });

  describe("when stop() is called on a long-running child", () => {
    it("sends SIGTERM and the child exits within the grace window", async () => {
      const bus = new EventBus();
      const sp = servicePaths(paths);
      const handle = supervise({
        spec: {
          name: "redis",
          command: "node",
          args: ["-e", "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);"],
          env: process.env,
        },
        paths: sp,
        bus,
      });

      // Give the child a moment to install the SIGTERM handler.
      await sleep(100);
      await handle.stop();
      // After stop resolves the child must have exited.
      expect(handle.child.exitCode === 0 || handle.child.signalCode != null).toBe(true);
    });
  });

  describe("when a child exits with a non-zero code", () => {
    it("emits a crashed event with the exit code", async () => {
      const bus = new EventBus();
      const sp = servicePaths(paths);
      supervise({
        spec: {
          name: "clickhouse",
          command: "node",
          args: ["-e", "process.exit(7);"],
          env: process.env,
        },
        paths: sp,
        bus,
      });

      let crashed: { code: number } | null = null;
      const it = bus[Symbol.asyncIterator]();
      while (true) {
        const r = await it.next();
        if (r.done) break;
        if (r.value.type === "crashed") {
          crashed = { code: r.value.code };
          break;
        }
      }
      expect(crashed).toEqual({ code: 7 });
    });
  });
});
