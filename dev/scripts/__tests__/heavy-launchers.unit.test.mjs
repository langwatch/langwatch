import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// Drives the patched tsc, vitest and oxlint launchers and with-build-slot.sh
// against a fake rush and a fake haven that record how they were called.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const require = createRequire(join(root, "package.json"));
const packageDir = (name) => dirname(require.resolve(`${name}/package.json`));

const launchers = [
  {
    program: "tsc",
    argv: [join(packageDir("typescript"), "lib", "tsc.js")],
    caps: ["GOMAXPROCS=2", "GOMEMLIMIT=3GiB"],
    node: true,
  },
  {
    program: "vitest",
    argv: [join(packageDir("vitest"), "vitest.mjs")],
    caps: ["VITEST_MAX_WORKERS=2"],
    node: true,
    sub: ["run"],
  },
  {
    program: "oxlint",
    argv: [join(packageDir("oxlint"), "bin", "oxlint")],
    caps: ["GOMAXPROCS=2"],
    node: true,
  },
  {
    program: "vite",
    argv: ["sh", join(root, "dev", "scripts", "with-build-slot.sh"), "vite", "vite"],
    caps: ["GOMAXPROCS=2", "GOMEMLIMIT=3GiB"],
    sub: ["build"],
  },
];

function recorder(dir, name) {
  const path = join(dir, name);
  const log = join(dir, `${name}.log`);
  writeFileSync(
    path,
    `#!/bin/sh\nprintf '%s\\n' "$@" "GOMAXPROCS=$GOMAXPROCS" "GOMEMLIMIT=$GOMEMLIMIT" "VITEST_MAX_WORKERS=$VITEST_MAX_WORKERS" > '${log}'\n`,
  );
  chmodSync(path, 0o755);
  return { path, log };
}

function launch(launcher, { shim = true, rushRunnable = true, env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "heavy-launchers-"));
  mkdirSync(join(dir, "gate", "bin"), { recursive: true });
  if (shim) writeFileSync(join(dir, "gate", "bin", launcher.program), "#!/bin/sh\n");
  const rush = recorder(dir, "rush");
  const haven = recorder(dir, "haven");
  const [command, ...rest] = launcher.node ? [process.execPath, ...launcher.argv] : launcher.argv;
  const result = spawnSync(command, [...rest, ...(launcher.sub ?? []), "probe"], {
    cwd: dir,
    encoding: "utf8",
    env: {
      PATH: "/usr/bin:/bin",
      HOME: dir,
      RUSH_HOME: dir,
      RUSH_BIN: rushRunnable ? rush.path : join(dir, "missing-rush"),
      HAVEN_BIN: haven.path,
      ...env,
    },
  });
  const read = (file) =>
    existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : undefined;
  return { dir, result, rush: read(rush.log), haven: read(haven.log) };
}

describe("heavy launchers and rush's gate", () => {
  /** @scenario "A launcher hands a run rush's gate owns to rush" */
  it("a shim and a runnable rush queue each launcher's run in rush, with caps", () => {
    for (const launcher of launchers) {
      const { dir, rush, haven } = launch(launcher);
      assert.equal(haven, undefined, `${launcher.program}: haven took a slot too`);
      assert.deepEqual(rush.slice(0, 6), ["gate", "run", "--name", launcher.program, "--dir", dir]);
      for (const cap of launcher.caps) assert.ok(rush.includes(cap), `${cap} missing from ${rush}`);
    }
  });

  /** @scenario "Without rush, haven queues as before" */
  it("no shim, or no runnable rush, sends each launcher's run to haven's slot", () => {
    for (const launcher of launchers) {
      for (const options of [{ shim: false }, { rushRunnable: false }]) {
        const { rush, haven } = launch(launcher, options);
        assert.equal(
          rush,
          undefined,
          `${launcher.program}: rush was asked with ${JSON.stringify(options)}`,
        );
        assert.deepEqual(haven.slice(0, 3), ["machine", "slot", "run"]);
      }
    }
  });

  /** @scenario "A run rush already admitted takes no haven slot" */
  it("with-build-slot.sh: a held run asks neither and runs under the caps", () => {
    const helper = {
      ...launchers[3],
      argv: [
        "sh",
        join(root, "dev", "scripts", "with-build-slot.sh"),
        "vite",
        "sh",
        "-c",
        'echo "$GOMAXPROCS $GOMEMLIMIT"',
      ],
      sub: [],
    };
    const { result, rush, haven } = launch(helper, { env: { RUSH_GATE_HELD: "scope" } });
    assert.equal(rush, undefined);
    assert.equal(haven, undefined);
    assert.equal(result.stdout.trim(), "2 3GiB");
  });

  /** @scenario "A run rush already admitted takes no haven slot" */
  it("tsc and oxlint: a held run asks neither and runs the tool directly", () => {
    for (const launcher of [launchers[0], launchers[2]]) {
      const { result, rush, haven } = launch(launcher, { env: { RUSH_GATE_HELD: "scope" } });
      assert.equal(rush, undefined, launcher.program);
      assert.equal(haven, undefined, launcher.program);
      assert.notEqual(result.status, null, result.stderr);
    }
  });

  /** @scenario "haven's own UI rebuild never waits behind agent runs" */
  it("with-build-slot.sh: haven's stack build skips rush and haven, keeping the caps", () => {
    const helper = {
      ...launchers[3],
      argv: [
        "sh",
        join(root, "dev", "scripts", "with-build-slot.sh"),
        "vite",
        "sh",
        "-c",
        'echo "$GOMAXPROCS $GOMEMLIMIT"',
      ],
      sub: [],
    };
    const { result, rush, haven } = launch(
      { ...helper, program: "sh" },
      { env: { HAVEN_STACK_BUILD: "1" } },
    );
    assert.equal(rush, undefined);
    assert.equal(haven, undefined);
    assert.equal(result.stdout.trim(), "2 3GiB");
  });
});
