/**
 * @vitest-environment node
 *
 * dev/scripts/dev-supervisor.mjs is only worth anything to the scripts that
 * run through it. It shipped written and tested with nothing routed to it: the
 * workspace `dev`, `dev:ui`, `dev:api` and `dev:worker` scripts started their
 * commands directly, so a Ctrl-C or a closed terminal left the stack running
 * and printing exactly as it had before.
 *
 * Corresponds to specs/setup/dev-stack-lifecycle.feature.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const SUPERVISOR = "dev/scripts/dev-supervisor.mjs";

/**
 * Every workspace script that starts a long-lived development process. A
 * script added here without the supervisor is one more way to leak a stack.
 */
const SUPERVISED_SCRIPTS = ["dev", "dev:ui", "dev:api", "dev:worker"] as const;

function workspaceScripts(): Record<string, string> {
  const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  return manifest.scripts ?? {};
}

describe("given the workspace scripts a developer starts development with", () => {
  describe("when each of them is read", () => {
    /** @scenario "Every script that starts a dev process is supervised" */
    it("runs every one of them through the supervisor", () => {
      const scripts = workspaceScripts();

      for (const name of SUPERVISED_SCRIPTS) {
        expect(scripts, `the workspace no longer scripts ${name}`).toHaveProperty(name);
        expect(scripts[name], `${name} does not go through the supervisor`).toContain(SUPERVISOR);
      }
    });

    /** @scenario "Every script that starts a dev process is supervised" */
    it("supervises each single lane, not only the whole stack", () => {
      const scripts = workspaceScripts();

      // The single-lane scripts leak the same way the stack does: `pnpm`
      // forwards nothing down its script chain, so a killed launcher leaves
      // vite or tsx running whether one lane was started or four.
      for (const name of ["dev:ui", "dev:api", "dev:worker"]) {
        expect(scripts[name]?.startsWith(`node ${SUPERVISOR} `)).toBe(true);
      }
    });
  });
});
