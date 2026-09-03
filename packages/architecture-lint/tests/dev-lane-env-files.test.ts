/**
 * @vitest-environment node
 *
 * Every api and worker script loaded the workspace env files with
 * `--env-file-if-exists`, and Node announces a file that flag did not find:
 *
 *   ../../.env.portless not found. Continuing without it.
 *
 * on stderr, in a form no flag suppresses. The portless overlay is written by
 * haven and absent in every other run, and both the tsx CLI process and the
 * child it spawns parse the flag, so each lane opened with the same sentence
 * twice.
 *
 * Corresponds to specs/setup/dev-stack-boot-noise.feature.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

/** Every workspace script that boots a Node lane over the workspace env files. */
const LANE_SCRIPTS = [
  { manifest: "apps/api/package.json", script: "dev" },
  { manifest: "apps/api/package.json", script: "start" },
  { manifest: "apps/worker/package.json", script: "dev" },
  { manifest: "apps/worker/package.json", script: "start" },
] as const;

let scratch: string;
/** A package directory two levels below the workspace root, as the lanes are. */
let laneDir: string;

beforeEach(() => {
  scratch = mkdtempSync(path.join(os.tmpdir(), "dev-lane-env-"));
  laneDir = path.join(scratch, "apps", "lane");
  mkdirSync(laneDir, { recursive: true });
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function scriptText({ manifest, script }: { manifest: string; script: string }): string {
  const parsed = JSON.parse(readFileSync(path.join(REPO_ROOT, manifest), "utf8")) as {
    scripts: Record<string, string>;
  };
  const text = parsed.scripts[script];
  if (text === undefined) throw new Error(`${manifest} no longer scripts ${script}`);
  return text;
}

/**
 * The env-file flags one of those scripts resolves to, evaluated by a shell in
 * a directory shaped like the lane's own — which is the only way to find out,
 * since the flags are a shell substitution over what is on disk.
 */
function resolvedEnvFlags(script: string): string {
  const substitutions = script.match(/\$\([^)]*\)/g) ?? [];
  return execFileSync("sh", ["-c", `echo ${substitutions.join(" ")}`], {
    cwd: laneDir,
    encoding: "utf8",
  }).trim();
}

describe("given a workspace with no portless overlay", () => {
  describe("when a lane starts", () => {
    /** @scenario "A dev lane says nothing about an overlay that was never written" */
    it("does not mention the overlay at all", () => {
      writeFileSync(path.join(scratch, ".env"), "PORT=5560\n");

      for (const lane of LANE_SCRIPTS) {
        const flags = resolvedEnvFlags(scriptText(lane));

        expect(flags).toBe("--env-file=../../.env");
        expect(flags).not.toContain("portless");
      }
    });

    /** @scenario "A dev lane says nothing about an overlay that was never written" */
    it("passes no flag Node would answer with a not-found notice", () => {
      // The notice is Node's own, on stderr, and neither --no-warnings nor any
      // other flag turns it off — which is why the fix is to stop passing the
      // flag rather than to quieten it.
      const notice = nodeStderr(["--env-file-if-exists=./definitely-absent.env"]);
      expect(notice).toContain("not found. Continuing without it.");

      for (const lane of LANE_SCRIPTS) {
        expect(scriptText(lane)).not.toContain("--env-file-if-exists");
      }
      expect(nodeStderr(resolvedEnvFlags(scriptText(LANE_SCRIPTS[0])).split(" "))).toBe("");
    });
  });
});

describe("given a workspace with a portless overlay", () => {
  describe("when a lane starts", () => {
    /** @scenario "The overlay is still loaded, and still last, when it is there" */
    it("loads the overlay after the workspace env file, so it wins", () => {
      writeFileSync(path.join(scratch, ".env"), "LANGWATCH_TEST_LANE=from-env\n");
      writeFileSync(path.join(scratch, ".env.portless"), "LANGWATCH_TEST_LANE=from-overlay\n");

      for (const lane of LANE_SCRIPTS) {
        const flags = resolvedEnvFlags(scriptText(lane));

        expect(flags).toBe("--env-file=../../.env --env-file=../../.env.portless");
        expect(
          execFileSync(
            process.execPath,
            [...flags.split(" "), "-e", "process.stdout.write(process.env.LANGWATCH_TEST_LANE)"],
            { cwd: laneDir, encoding: "utf8" },
          ),
        ).toBe("from-overlay");
      }
    });
  });
});

/** What Node writes to stderr for a run that does nothing else. */
function nodeStderr(flags: readonly string[]): string {
  const argv = flags
    .filter((flag) => flag !== "")
    .map((flag) => `'${flag.replace(/'/g, "'\\''")}'`)
    .join(" ");
  return execFileSync("sh", ["-c", `'${process.execPath}' ${argv} -e '' 2>&1 1>/dev/null`], {
    cwd: laneDir,
    encoding: "utf8",
  }).trim();
}
