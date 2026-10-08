/**
 * @vitest-environment node
 *
 * `make service` / `make service-watch` load DEV_ENV_FILE through
 * dev/scripts/lib/load-dev-env.sh. Under a POSIX /bin/sh such as dash, `.`
 * looks a slash-free name up on PATH only, so `. .env` fails with
 * ".: .env: not found". These tests source the helper with /bin/sh (dash on
 * the Linux CI runners) from a folder whose path has a space, and check that
 * both recipes call it.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const HELPER = path.join(REPO_ROOT, "dev/scripts/lib/load-dev-env.sh");
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "load dev env "));
fs.writeFileSync(path.join(workDir, ".env"), "LOAD_DEV_ENV_TEST=loaded\n");

function loadWithSh(envFile: string): string {
  return execFileSync(
    "/bin/sh",
    ["-c", `. "${HELPER}" && load_dev_env "$1" && sh -c 'echo "$LOAD_DEV_ENV_TEST"'`, "sh", envFile],
    { cwd: workDir, encoding: "utf8", env: { PATH: "/usr/bin:/bin" } },
  ).trim();
}

describe("load-dev-env.sh", () => {
  afterAll(() => fs.rmSync(workDir, { recursive: true, force: true }));

  describe("when DEV_ENV_FILE is a name without a slash", () => {
    /** @scenario "make service loads a DEV_ENV_FILE named without a slash under any POSIX sh" */
    it("exports the variables of the file in the current folder", () => {
      expect(loadWithSh(".env")).toBe("loaded");
    });
  });

  describe("when DEV_ENV_FILE is an absolute path with a space", () => {
    it("exports the variables of that file", () => {
      expect(loadWithSh(path.join(workDir, ".env"))).toBe("loaded");
    });
  });

  for (const target of ["service", "service-watch"]) {
    describe(`when make ${target} runs`, () => {
      it("loads DEV_ENV_FILE through the helper, quoted", () => {
        const recipe = execFileSync(
          "make",
          ["-n", target, "svc=aigateway", "DEV_ENV_FILE=.env"],
          { cwd: REPO_ROOT, encoding: "utf8", env: { PATH: process.env.PATH ?? "" } },
        );
        expect(recipe).toContain('. dev/scripts/lib/load-dev-env.sh && load_dev_env ".env"');
      });
    });
  }
});
