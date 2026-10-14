// specs/setup/dev-fixture-seeds.feature: the widget seeds refuse any endpoint but a local host.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEEDS = ["legacy-parity-widgets/seed.mjs", "north-star-widgets/seed.mjs"];

const seed = ({ script, endpoint }) =>
  spawnSync(process.execPath, [path.join(scriptsDir, script)], {
    env: {
      PATH: process.env.PATH,
      LW_ENDPOINT: endpoint,
      LW_API_KEY: "test-key",
      PROJECT_ID: "test-project",
    },
    encoding: "utf8",
    timeout: 10_000,
  });

for (const script of SEEDS) {
  describe(script, () => {
    /** @scenario "A widget fixture seed refuses an endpoint that is not a local host" */
    it("A widget fixture seed refuses an endpoint that is not a local host", () => {
      const run = seed({ script, endpoint: "https://app.example.com" });
      assert.equal(run.status, 1);
      assert.match(run.stderr, /LW_ENDPOINT host "app\.example\.com" is not local/);
    });

    /** @scenario "A widget fixture seed refuses an endpoint that is not a URL" */
    it("A widget fixture seed refuses an endpoint that is not a URL", () => {
      const run = seed({ script, endpoint: "not a url" });
      assert.equal(run.status, 1);
      assert.match(run.stderr, /LW_ENDPOINT is not a valid URL/);
    });

    /** @scenario "A widget fixture seed accepts a local endpoint" */
    it("A widget fixture seed accepts a local endpoint", () => {
      const run = seed({ script, endpoint: "http://127.0.0.1:9" });
      assert.doesNotMatch(run.stderr, /Refusing to seed/);
    });
  });
}
