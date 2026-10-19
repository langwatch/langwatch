/**
 * @vitest-environment node
 * @see ../../../../specs/upgrade/upgrade-stuck-states-locks.feature
 * A fake `goose` on PATH stands in for a slow migration; nothing reaches ClickHouse.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getMigrateVersion } from "../goose.migration-runner.ts";

const URL = "http://localhost:8123/langwatch";
let dir: string;
let path: string | undefined;

function fakeGoose({ body }: { body: string }): void {
  const file = join(dir, "goose");
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fake-goose-"));
  path = process.env.PATH;
  process.env.PATH = `${dir}:${path ?? ""}`;
});

afterEach(() => {
  process.env.PATH = path;
  rmSync(dir, { recursive: true, force: true });
});

describe("goose under the upgrade lease", () => {
  describe("when a goose run outlasts several heartbeats", () => {
    /** @scenario "The lease heartbeat keeps renewing while goose runs" */
    it("lets timers fire while goose runs", async () => {
      fakeGoose({ body: "sleep 0.6\necho version 1" });
      let ticks = 0;
      const heartbeat = setInterval(() => ticks++, 50);
      try {
        await getMigrateVersion({ connectionUrl: URL, childEnvironment: { PATH: path } });
      } finally {
        clearInterval(heartbeat);
      }
      expect(ticks).toBeGreaterThanOrEqual(5);
    });
  });

  describe("when the lease is lost mid-run", () => {
    /** @scenario "Losing the upgrade lease stops goose" */
    it("kills goose and fails the run", async () => {
      fakeGoose({ body: "exec sleep 30" });
      const lease = new AbortController();
      setTimeout(() => lease.abort(new Error("the upgrade lease expired")), 100);
      const startedAt = performance.now();
      await expect(
        getMigrateVersion({
          connectionUrl: URL,
          childEnvironment: { PATH: path },
          signal: lease.signal,
        }),
      ).rejects.toThrow(/Goose migration failed/);
      expect(performance.now() - startedAt).toBeLessThan(5_000);
    });
  });
});
