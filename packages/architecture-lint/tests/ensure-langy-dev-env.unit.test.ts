/**
 * @vitest-environment node
 *
 * Tests for dev/scripts/ensure-langy-dev-env.sh, the launcher step that fills
 * in the Langy settings a developer used to paste out of the dogfood doctor.
 *
 * See specs/setup/dev-langy-agent-lane.feature.
 *
 * The script is run against a fixture tree shaped like dev/scripts, because it
 * resolves the env file two directories above itself, and the assertions read
 * that file back rather than the script's own output.
 */

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const SCRIPT = path.join(REPO_ROOT, "dev/scripts/ensure-langy-dev-env.sh");
const LIB = path.join(REPO_ROOT, "dev/scripts/lib/env-file-keys.sh");

const roots: string[] = [];

function fixture(envFile?: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "ensure-langy-dev-env-"));
  roots.push(root);
  mkdirSync(path.join(root, "dev/scripts/lib"), { recursive: true });
  copyFileSync(SCRIPT, path.join(root, "dev/scripts/ensure-langy-dev-env.sh"));
  copyFileSync(LIB, path.join(root, "dev/scripts/lib/env-file-keys.sh"));
  if (envFile !== undefined) writeFileSync(path.join(root, ".env"), envFile);
  return root;
}

function run({ root, env = {} }: { root: string; env?: Record<string, string> }): {
  stdout: string;
  envFile: string;
} {
  const stdout = execFileSync("bash", [path.join(root, "dev/scripts/ensure-langy-dev-env.sh")], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: root, ...env },
  });
  const envPath = path.join(root, ".env");
  return { stdout, envFile: existsSync(envPath) ? readFileSync(envPath, "utf8") : "" };
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("ensure-langy-dev-env.sh", () => {
  describe("given a checkout that carries none of the Langy settings", () => {
    describe("when the developer starts the stack", () => {
      /** @scenario "A checkout with no Langy block gets one" */
      it("generates a shared secret for the manager and the control plane", () => {
        const { envFile } = run({ root: fixture("SOMETHING_ELSE=keep-me\n") });

        expect(envFile).toMatch(/^LANGY_INTERNAL_SECRET=[0-9a-f]{64}$/m);
        expect(envFile).toContain("SOMETHING_ELSE=keep-me");
      });

      /** @scenario "A checkout with no Langy block gets one" */
      it("points the session and workspace roots inside this developer's home", () => {
        const root = fixture("");

        const { envFile } = run({ root });

        expect(envFile).toContain(`SESSIONS_ROOT="${root}/.langwatch-langy/`);
        expect(envFile).toContain(`LANGY_WORKSPACE_ROOT="${root}/.langwatch-langy/`);
      });

      /** @scenario "A checkout with no Langy block gets one" */
      it("force-enables the panel's release flag", () => {
        const { envFile } = run({ root: fixture("") });

        expect(envFile).toMatch(/^FEATURE_FLAG_FORCE_ENABLE="release_langy_enabled"$/m);
      });

      /** @scenario "A checkout with no Langy block gets one" */
      it("turns on the isolation bypass a laptop needs", () => {
        const { envFile } = run({ root: fixture("") });

        expect(envFile).toMatch(/^LANGY_UNSAFE_DEV_DISABLE_ISOLATION=true$/m);
      });
    });
  });

  describe("given settings the developer already chose", () => {
    describe("when the developer starts the stack", () => {
      /** @scenario "Settings the developer already chose are left alone" */
      it("leaves them exactly as they were and adds only what was missing", () => {
        const root = fixture(
          'LANGY_INTERNAL_SECRET=mine-do-not-touch\nLANGY_WORKSPACE_ROOT="/srv/langy"\n',
        );

        const { envFile } = run({ root });

        expect(envFile).toContain("LANGY_INTERNAL_SECRET=mine-do-not-touch");
        expect(envFile).toContain('LANGY_WORKSPACE_ROOT="/srv/langy"');
        expect(envFile).toMatch(/^SESSIONS_ROOT=/m);
      });

      /** @scenario "Settings the developer already chose are left alone" */
      it("changes nothing at all on a second run", () => {
        const root = fixture("");

        const first = run({ root }).envFile;
        const second = run({ root });

        expect(second.envFile).toBe(first);
        expect(second.stdout).not.toContain("generated");
      });
    });
  });

  describe("given a flag list that already forces another flag on", () => {
    describe("when the developer starts the stack", () => {
      /** @scenario "The release flag joins the flags already forced on" */
      it("adds the Langy flag beside the one already there", () => {
        const { envFile } = run({
          root: fixture('FEATURE_FLAG_FORCE_ENABLE="release_ui_langy_peek_dock_enabled"\n'),
        });

        expect(envFile).toContain(
          'FEATURE_FLAG_FORCE_ENABLE="release_ui_langy_peek_dock_enabled,release_langy_enabled"',
        );
      });

      /** @scenario "A flag list that already names Langy is not rewritten" */
      it("leaves a list that already names Langy alone", () => {
        const { envFile } = run({
          root: fixture("FEATURE_FLAG_FORCE_ENABLE=release_langy_enabled\n"),
        });

        expect(envFile).toContain("FEATURE_FLAG_FORCE_ENABLE=release_langy_enabled");
        expect(envFile).not.toContain("release_langy_enabled,release_langy_enabled");
      });
    });
  });

  describe("given a checkout with no env file yet", () => {
    describe("when the developer starts the stack", () => {
      /** @scenario "A checkout with no env file is left to the env-file check" */
      it("writes nothing and creates no env file", () => {
        const root = fixture();

        const { envFile } = run({ root });

        expect(envFile).toBe("");
        expect(existsSync(path.join(root, ".env"))).toBe(false);
      });
    });
  });

  describe("given a production environment", () => {
    describe("when the launcher is asked to fill in the Langy settings", () => {
      /** @scenario "A production launcher writes nothing" */
      it("writes nothing and says the settings are for development only", () => {
        const root = fixture("SOMETHING_ELSE=keep-me\n");

        const { stdout, envFile } = run({ root, env: { NODE_ENV: "production" } });

        expect(envFile).toBe("SOMETHING_ELSE=keep-me\n");
        expect(stdout).toContain("development only");
      });
    });
  });
});
