/**
 * @vitest-environment node
 * @see specs/scenarios/pre-compiled-child-process.feature
 *
 * Starts the child from its TypeScript source through the tsx installed in
 * this package. It does not build the bundle and does not read one.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TSX_BIN = path.join(PACKAGE_ROOT, "node_modules", ".bin", "tsx");

describe("scenario child source", () => {
  /** @scenario "Installed tsx starts the child source without a bundle" */
  it("reports invalid job data when started from source through the installed tsx", () => {
    expect(fs.existsSync(TSX_BIN)).toBe(true);

    const boot = spawnSync(TSX_BIN, ["src/main.ts"], {
      cwd: PACKAGE_ROOT,
      input: "{}",
      stdio: "pipe",
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        NODE_ENV: "development",
        SKIP_ENV_VALIDATION: "1",
        LANGWATCH_API_KEY: "test-key",
        LANGWATCH_ENDPOINT: "http://localhost:9999",
        SCENARIO_HEADLESS: "true",
      },
      timeout: 90_000,
    });

    expect(boot.status).toBe(1);
    expect(boot.stdout).toContain("Failed to parse job data");
    expect(boot.stdout).toContain('"success":false');
  }, 120_000);
});
