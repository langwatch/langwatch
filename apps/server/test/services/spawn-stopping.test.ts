import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EventBus } from "../../src/services/event-bus.ts";
import { servicePaths } from "../../src/services/paths.ts";
import { stopEverySupervised, supervise } from "../../src/services/spawn.ts";

// Its own file: the stop is final for the process, so it would refuse every later launch.
describe("supervise", () => {
  const root = mkdtempSync(join(tmpdir(), "lw-spawn-stopping-"));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  describe("when a start finishes its step after the stop began", () => {
    /** @scenario "Aborting the install stops the services already started" */
    it("refuses to launch, so nothing is left running once the CLI exits", async () => {
      const paths = servicePaths({
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
      });
      await stopEverySupervised();

      let refusal: unknown;
      try {
        supervise({
          spec: { name: "postgres", command: "node", args: ["-e", ""], env: process.env },
          paths,
          bus: new EventBus(),
        });
      } catch (error) {
        refusal = error;
      }

      expect(refusal).toMatchObject({ code: "supervision_stopped" });
    });
  });
});
