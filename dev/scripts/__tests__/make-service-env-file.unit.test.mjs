// `make service` / `make service-watch` load DEV_ENV_FILE through
// dev/scripts/lib/load-dev-env.sh. Under a POSIX /bin/sh such as dash, `.`
// looks a slash-free name up on PATH only, so `. .env` fails. These run the
// helper with /bin/sh and both recipes with stand-in `go` and `air` binaries
// that print what reached the service's environment.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const HELPER = path.join(REPO_ROOT, "dev/scripts/lib/load-dev-env.sh");
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "load dev env "));
fs.writeFileSync(path.join(workDir, ".env"), "LOAD_DEV_ENV_TEST=loaded\n");

const fakeBin = path.join(workDir, "bin");
fs.mkdirSync(fakeBin);
for (const name of ["go", "air"]) {
  fs.writeFileSync(
    path.join(fakeBin, name),
    '#!/bin/sh\necho "service env: $LOAD_DEV_ENV_TEST"\n',
    {
      mode: 0o755,
    },
  );
}

const repoEnvName = `.env.load-dev-env-test-${process.pid}`;

function loadWithSh({ envFile }) {
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
    return { out: (e.stdout ?? "").trim(), status: e.status ?? 1 };
  }
}
// make service builds the sim consoles (pnpm) and pipes logs through node; stubs keep this about env loading.
fs.writeFileSync(path.join(fakeBin, "pnpm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
fs.writeFileSync(path.join(fakeBin, "node"), "#!/bin/sh\ncat\n", { mode: 0o755 });

function runMake({ target, envFile = repoEnvName }) {
  return execFileSync("make", ["-s", target, "svc=aigateway", `DEV_ENV_FILE=${envFile}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { PATH: `${fakeBin}:/usr/bin:/bin` },
  });
}

describe("load-dev-env.sh", () => {
  before(() => {
    fs.writeFileSync(path.join(REPO_ROOT, repoEnvName), "LOAD_DEV_ENV_TEST=from-make\n");
    fs.writeFileSync(path.join(REPO_ROOT, `${repoEnvName}.bad`), "false\n");
  });

  after(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(path.join(REPO_ROOT, repoEnvName), { force: true });
    fs.rmSync(path.join(REPO_ROOT, `${repoEnvName}.bad`), { force: true });
  });

  describe("when DEV_ENV_FILE is a name without a slash", () => {
    /** @scenario "make service loads a DEV_ENV_FILE named without a slash under any POSIX sh" */
    it("exports the variables of the file in the current folder", () => {
      assert.deepEqual(loadWithSh({ envFile: ".env" }), { out: "loaded", status: 0 });
    });
  });

  describe("when DEV_ENV_FILE is an absolute path with a space", () => {
    /** @scenario "make service loads DEV_ENV_FILE from a path that contains spaces" */
    it("exports the variables of that file", () => {
      assert.equal(loadWithSh({ envFile: path.join(workDir, ".env") }).out, "loaded");
    });
  });

  describe("when the env file loads", () => {
    it("adds only the variables the file sets", () => {
      fs.writeFileSync(path.join(workDir, "empty.env"), "");
      const envAfter = (file) =>
        execFileSync("/bin/sh", ["-c", `. "${HELPER}" && load_dev_env "$1" && env`, "sh", file], {
          cwd: workDir,
          encoding: "utf8",
          env: { PATH: "/usr/bin:/bin" },
        })
          .trim()
          .split("\n")
          .filter((line) => !line.startsWith("_="));
      const empty = new Set(envAfter("empty.env"));
      const added = envAfter(".env").filter((line) => !empty.has(line));
      assert.deepEqual(added, ["LOAD_DEV_ENV_TEST=loaded"]);
    });
  });

  describe("when the env file fails while loading", () => {
    it("returns that failure", () => {
      fs.writeFileSync(path.join(workDir, "bad.env"), "A=1\nfalse\n");
      assert.notEqual(loadWithSh({ envFile: "bad.env" }).status, 0);
    });
  });

  for (const target of ["service", "service-watch"]) {
    describe(`when make ${target} gets a DEV_ENV_FILE without a slash`, () => {
      it("starts the service with the variables of that file", () => {
        assert.match(runMake({ target }), /service env: from-make/);
      });
    });
  }

  for (const target of ["service", "service-watch"]) {
    describe(`when make ${target} gets an env file that fails to load`, () => {
      /** @scenario "make service stops when DEV_ENV_FILE exists but fails to load" */
      it("stops before starting the service, without calling the file missing", () => {
        let output = "";
        try {
          runMake({ target, envFile: `${repoEnvName}.bad` });
        } catch (e) {
          output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
        }
        assert.match(output, /Error/);
        assert.doesNotMatch(output, /service env:/);
        assert.doesNotMatch(output, /not found/);
      });
    });
  }
});
