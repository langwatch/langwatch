/**
 * @vitest-environment node
 *
 * The seed's env loader, exercised the way the seed loads it: as the side
 * effect of importing the module in a real Node process. Nothing here asserts
 * on the module's source — each case runs `tsx` on an import of seed-env.ts and
 * reads back the process.env it produced, which is the only thing the seed
 * actually depends on.
 *
 * It spawns a process rather than importing the module here, because the
 * contract is what a fresh Node process ends up with: importing it in-band
 * would mutate this run's own environment and cache the module across cases.
 *
 * @see specs/setup/haven-seed-presets.feature
 */

import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "../..");
const SEED_ENV = path.join(APP_ROOT, "prisma", "seed-env.ts");
const TSX = path.join(APP_ROOT, "node_modules", ".bin", "tsx");

/** Runs seed-env.ts in `cwd` and returns the variables it left in process.env. */
function loadSeedEnvIn(
  cwd: string,
  extraEnv: Record<string, string> = {},
): Record<string, string> {
  const result = spawnSync(
    TSX,
    [
      "-e",
      `import ${JSON.stringify(SEED_ENV)};\n` +
        `console.log(JSON.stringify(process.env));`,
    ],
    {
      cwd,
      encoding: "utf8",
      // A clean-ish parent env: the point of the module is that the seed no
      // longer depends on the launching shell carrying these.
      env: { PATH: process.env.PATH ?? "", HOME: os.homedir(), ...extraEnv },
    },
  );
  if (result.status !== 0) {
    throw new Error(`tsx exited ${result.status}: ${result.stderr}`);
  }
  return JSON.parse(result.stdout.trim().split("\n").at(-1)!) as Record<
    string,
    string
  >;
}

describe("given the seed's env files exist above and beside its working directory", () => {
  let workspace: string;
  let appDir: string;

  beforeAll(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "seed-env-"));
    appDir = path.join(workspace, "app");
    fs.mkdirSync(appDir);
    fs.writeFileSync(
      path.join(workspace, ".env"),
      "SEED_ENV_LAYER=outer\nSEED_ENV_OUTER_ONLY=outer-value\n",
    );
    fs.writeFileSync(
      path.join(appDir, ".env"),
      "SEED_ENV_LAYER=app\nNEXTAUTH_SECRET=from-dotenv\n",
    );
  });

  afterAll(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  describe("when the module is imported", () => {
    /** @scenario "The seed reads its own environment files" */
    it("puts the variables the env schema validates into the process environment", () => {
      // The failure this guards: seed.ts imports src/utils/encryption, which
      // validates the whole env schema while the module graph evaluates, so a
      // seed whose shell never exported NEXTAUTH_SECRET died on "Required"
      // before its first query — which is every haven `up`.
      expect(loadSeedEnvIn(appDir).NEXTAUTH_SECRET).toBe("from-dotenv");
    });

    it("prefers the working directory's env file over the layer above it", () => {
      expect(loadSeedEnvIn(appDir).SEED_ENV_LAYER).toBe("app");
    });

    it("still reads variables only the layer above defines", () => {
      expect(loadSeedEnvIn(appDir).SEED_ENV_OUTER_ONLY).toBe("outer-value");
    });
  });

  describe("when a variable is already set in the environment", () => {
    /** @scenario "The seed keeps the database it was handed" */
    it("leaves it alone", () => {
      // Load-bearing, not incidental: haven hands the seed the per-slug
      // DATABASE_URL of the stack it is bringing up. An overriding load would
      // hand that back to whatever .env pins and seed the wrong database.
      const env = loadSeedEnvIn(appDir, { SEED_ENV_LAYER: "from-overlay" });
      expect(env.SEED_ENV_LAYER).toBe("from-overlay");
    });
  });

  describe("when no env file exists at all", () => {
    it("loads nothing and does not fail", () => {
      const bare = fs.mkdtempSync(path.join(os.tmpdir(), "seed-env-bare-"));
      try {
        expect(loadSeedEnvIn(bare).SEED_ENV_LAYER).toBeUndefined();
      } finally {
        fs.rmSync(bare, { recursive: true, force: true });
      }
    });
  });
});
