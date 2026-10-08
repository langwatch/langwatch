/**
 * @vitest-environment node
 *
 * `make service` / `make service-watch` load DEV_ENV_FILE with `.`. Under a
 * POSIX /bin/sh such as dash, `.` looks a slash-free name up on PATH only, so
 * the recipe must hand it an absolute path, quoted for checkouts whose path
 * has spaces. These tests read the recipe make would run (`make -n`).
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

function recipe(target: string): string {
  return execFileSync(
    "make",
    ["-n", target, "svc=aigateway", "DEV_ENV_FILE=.env"],
    { cwd: REPO_ROOT, encoding: "utf8", env: { PATH: process.env.PATH ?? "" } },
  );
}

describe("make service env file", () => {
  for (const target of ["service", "service-watch"]) {
    describe(`when ${target} gets DEV_ENV_FILE=.env`, () => {
      /** @scenario "make service loads a DEV_ENV_FILE named without a slash under any POSIX sh" */
      it("sources the file by its quoted absolute path", () => {
        const out = recipe(target);
        expect(out).toContain(`. "${path.join(REPO_ROOT, ".env")}"`);
        expect(out).not.toMatch(/\. \.env\b/);
      });
    });
  }
});
