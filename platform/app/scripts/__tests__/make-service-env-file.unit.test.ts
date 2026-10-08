/**
 * @vitest-environment node
 *
 * `make service` / `make service-watch` load DEV_ENV_FILE through
 * dev/scripts/lib/load-dev-env.sh. Under a POSIX /bin/sh such as dash, `.`
 * looks a slash-free name up on PATH only, so `. .env` fails with
 * ".: .env: not found". These tests run the helper with /bin/sh (dash on the
 * Linux CI runners) and run both recipes with stand-in `go` and `air`
 * binaries that print what reached the service's environment.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const HELPER = path.join(REPO_ROOT, "dev/scripts/lib/load-dev-env.sh");
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "load dev env "));
fs.writeFileSync(path.join(workDir, ".env"), "LOAD_DEV_ENV_TEST=loaded\n");

const fakeBin = path.join(workDir, "bin");
fs.mkdirSync(fakeBin);
for (const name of ["go", "air"]) {
  fs.writeFileSync(
    path.join(fakeBin, name),
    '#!/bin/sh\necho "service env: $LOAD_DEV_ENV_TEST"\n',
    { mode: 0o755 },
  );
}

const repoEnvName = `.env.load-dev-env-test-${process.pid}`;

function loadWithSh(envFile: string): { out: string; status: number } {
  const script = `. "${HELPER}" && load_dev_env "$1"; s=$?; echo "$LOAD_DEV_ENV_TEST"; exit $s`;
  try {
    const out = execFileSync("/bin/sh", ["-c", script, "sh", envFile], {
      cwd: workDir,
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { out: out.trim(), status: 0 };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { out: (err.stdout ?? "").trim(), status: err.status ?? 1 };
  }
}

function runMake(target: string): string {
  return execFileSync(
    "make",
    ["-s", target, "svc=aigateway", `DEV_ENV_FILE=${repoEnvName}`],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { PATH: `${fakeBin}:/usr/bin:/bin` },
    },
  );
}

describe("load-dev-env.sh", () => {
  beforeAll(() => {
    fs.writeFileSync(
      path.join(REPO_ROOT, repoEnvName),
      "LOAD_DEV_ENV_TEST=from-make\n",
    );
  });

  afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(path.join(REPO_ROOT, repoEnvName), { force: true });
  });

  describe("when DEV_ENV_FILE is a name without a slash", () => {
    /** @scenario "make service loads a DEV_ENV_FILE named without a slash under any POSIX sh" */
    it("exports the variables of the file in the current folder", () => {
      expect(loadWithSh(".env")).toEqual({ out: "loaded", status: 0 });
    });
  });

  describe("when DEV_ENV_FILE is an absolute path with a space", () => {
    it("exports the variables of that file", () => {
      expect(loadWithSh(path.join(workDir, ".env")).out).toBe("loaded");
    });
  });

  describe("when the env file loads", () => {
    it("adds only the variables the file sets", () => {
      fs.writeFileSync(path.join(workDir, "empty.env"), "");
      const envAfter = (file: string) =>
        execFileSync(
          "/bin/sh",
          ["-c", `. "${HELPER}" && load_dev_env "$1" && env`, "sh", file],
          { cwd: workDir, encoding: "utf8", env: { PATH: "/usr/bin:/bin" } },
        )
          .trim()
          .split("\n")
          .filter((line) => !line.startsWith("_="));
      const empty = new Set(envAfter("empty.env"));
      const added = envAfter(".env").filter((line) => !empty.has(line));
      expect(added).toEqual(["LOAD_DEV_ENV_TEST=loaded"]);
    });
  });

  describe("when the env file fails while loading", () => {
    it("returns that failure", () => {
      fs.writeFileSync(path.join(workDir, "bad.env"), "A=1\nfalse\n");
      expect(loadWithSh("bad.env").status).not.toBe(0);
    });
  });

  for (const target of ["service", "service-watch"]) {
    describe(`when make ${target} gets a DEV_ENV_FILE without a slash`, () => {
      it("starts the service with the variables of that file", () => {
        expect(runMake(target)).toContain("service env: from-make");
      });
    });
  }
});
