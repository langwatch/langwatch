// specs/upgrade/upgrade-rehearsal.feature: the driver's plan and preflight, with docker stubbed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "rehearse.sh");

function run({ args, path = process.env.PATH }) {
  return spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: path },
  });
}

const plan = (stdout) =>
  Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .map((l) => l.split(/=(.*)/s).slice(0, 2)),
  );

void describe("planning an origin", () => {
  /** @scenario "Each origin names the old image it rehearses from" */
  void it("resolves 3.20.1 to the published image, refuses main without one and seeds nothing from empty", () => {
    const floor = run({ args: ["--origin", "3.20.1", "--head-image", "h:1", "--plan-only"] });
    assert.equal(floor.status, 0, floor.stderr);
    assert.equal(plan(floor.stdout).old_image, "langwatch/langwatch:3.20.1");

    const main = run({ args: ["--origin", "main", "--head-image", "h:1", "--plan-only"] });
    assert.equal(main.status, 2);
    assert.match(main.stderr, /--old-image IMAGE or --build-main/);

    const built = run({
      args: ["--origin", "main", "--build-main", "--head-image", "h:1", "--plan-only"],
    });
    assert.equal(plan(built.stdout).old_image, "langwatch-rehearsal:main");

    const empty = run({ args: ["--origin", "empty", "--head-image", "h:1", "--plan-only"] });
    assert.equal(empty.status, 0, empty.stderr);
    assert.equal(plan(empty.stdout).old_image, "");
    assert.equal(plan(empty.stdout).seed_traces, "0");
  });

  void it("refuses a run with no head image", () => {
    const result = run({ args: ["--plan-only"] });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--head-image IMAGE or --build-head/);
  });
});

void describe("a host that cannot run compose", () => {
  /** @scenario "The rehearsal refuses to start and names what is missing when the host cannot run compose" */
  void it("exits 3, names the daemon and writes no report", () => {
    const bin = mkdtempSync(join(tmpdir(), "mig-rehearsal-bin-"));
    const docker = join(bin, "docker");
    writeFileSync(docker, '#!/bin/sh\n[ "$1" = info ] && exit 1\nexit 0\n');
    chmodSync(docker, 0o755);
    const runDir = join(mkdtempSync(join(tmpdir(), "mig-rehearsal-run-")), "run");

    const result = run({
      args: ["--head-image", "h:1", "--run-dir", runDir],
      path: `${bin}:${process.env.PATH}`,
    });

    assert.equal(result.status, 3, result.stderr);
    assert.match(result.stderr, /a reachable docker daemon/);
    assert.equal(existsSync(runDir), false);
    assert.deepEqual(readdirSync(bin), ["docker"]);
  });
});
