/**
 * @vitest-environment node
 * Guards the api lane's port being exported, not just computed. Driven as
 * real processes: a stand-in `pnpm` reports its argv/env instead of starting.
 */

import { execFileSync, execSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const DEV_STACK = path.join(REPO_ROOT, "dev/scripts/dev-stack.sh");
const DERIVE_PORTS = path.join(REPO_ROOT, "dev/scripts/lib/derive-dev-ports.sh");

/**
 * A PORT slot far from the default so a developer's own stack, or another
 * worktree's, can never be what this test measures. The pre-flight refuses to
 * run when any of the three is held, failing loudly rather than measuring it.
 */
const SLOT = 5920;

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(path.join(os.tmpdir(), "dev-stack-ports-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Sources the port helper the way the launcher and the pre-flight do. */
function derivePorts(env: Record<string, string | undefined>): Record<string, string> {
  const lines = Object.entries(env)
    .map(([key, value]) =>
      value === undefined ? `unset ${key}` : `export ${key}='${value.replace(/'/g, "'\\''")}'`,
    )
    .join("\n");
  const script = `
set -e
${lines}
. "${DERIVE_PORTS}"
derive_dev_ports
echo "APP_PORT=\${APP_PORT:-}"
echo "API_PORT=\${API_PORT:-}"
echo "WORKER_METRICS_PORT=\${WORKER_METRICS_PORT:-}"
echo "GATEWAY_PORT=\${GATEWAY_PORT:-}"
`;
  const stdout = execSync("bash -s", {
    encoding: "utf8",
    input: script,
    // A bare environment: PORT and friends off the developer's own shell would
    // otherwise decide what this test measures.
    env: { PATH: process.env.PATH ?? "" },
  });
  return Object.fromEntries(
    stdout
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

/**
 * Runs the launcher with a `pnpm` that reports rather than runs. What comes
 * back is exactly what the lanes would have been started with.
 */
function launchWithStubbedPnpm(): { argv: string[]; env: Record<string, string> } {
  const bin = path.join(scratch, "bin");
  execFileSync("mkdir", ["-p", bin]);
  const stub = path.join(bin, "pnpm");
  writeFileSync(
    stub,
    [
      "#!/bin/bash",
      'echo "__ARGV__"',
      'for arg in "$@"; do printf "%s\\n" "$arg"; done',
      'echo "__ENV__"',
      "env",
    ].join("\n"),
  );
  chmodSync(stub, 0o755);
  // The go lane is only planned when a Go toolchain is on PATH; a stand-in
  // makes that deterministic, and the stubbed pnpm never runs it.
  const go = path.join(bin, "go");
  writeFileSync(go, "#!/bin/bash\nexit 0\n");
  chmodSync(go, 0o755);

  // Absent, not blank. A variable inherited from the environment keeps its
  // export flag when bash reassigns it, so passing these through as "" would
  // export the derived value for the script and hide the very bug this test
  // exists for.
  const inherited = { ...process.env };
  for (const key of [
    "API_PORT",
    "WORKER_METRICS_PORT",
    "GATEWAY_PORT",
    "LANGWATCH_API_PORT",
    "LANGWATCH_SKIP_AIGATEWAY",
    "LANGWATCH_GO_AIGATEWAY_ADDR",
  ]) {
    delete inherited[key];
  }

  const stdout = execFileSync("bash", [DEV_STACK], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: {
      ...inherited,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      PORT: String(SLOT),
      NODE_ENV: "development",
      NO_COLOR: "1",
    },
    maxBuffer: 8 * 1024 * 1024,
  });

  // pnpm runs the db prep first; the lanes are its last invocation.
  const argvBlock = stdout.slice(stdout.lastIndexOf("__ARGV__") + "__ARGV__\n".length);
  const argv = argvBlock.slice(0, argvBlock.indexOf("__ENV__")).split("\n").filter(Boolean);
  const envBlock = argvBlock.slice(argvBlock.indexOf("__ENV__") + "__ENV__\n".length);
  const env = Object.fromEntries(
    envBlock
      .split("\n")
      .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
  return { argv, env };
}

describe("given a dev launcher deriving its ports from PORT", () => {
  describe("when it starts the lanes", () => {
    /** @scenario "Each lane is told the port that was derived for it" */
    it(
      "hands each lane its own port instead of keeping the derivation to itself",
      { timeout: 90_000 },
      () => {
        const { argv, env } = launchWithStubbedPnpm();

        expect(env.API_PORT).toBe(String(SLOT + 1000));
        expect(env.WORKER_METRICS_PORT).toBe(String(SLOT - 2561));
        expect(env.GATEWAY_PORT).toBe(String(SLOT + 3));
        // The gateway reads an address, not a port number, and the launcher
        // announces the port it checked was free — so the two have to agree.
        expect(env.LANGWATCH_GO_AIGATEWAY_ADDR).toBe(`:${SLOT + 3}`);
        const goLane = argv.find((arg) => arg.includes("svc=combined"));
        expect(goLane).toContain("aigateway");
      },
    );

    /** @scenario "The pre-flight reserves all three Node ports" */
    it(
      "reserves the browser application, api and worker metrics ports",
      { timeout: 60_000 },
      () => {
        const preflight = execFileSync(
          "bash",
          [path.join(REPO_ROOT, "dev/scripts/check-ports.sh")],
          {
            encoding: "utf8",
            cwd: REPO_ROOT,
            env: { ...process.env, PORT: String(SLOT), NODE_ENV: "development", NO_COLOR: "1" },
          },
        );
        // Nothing holds the slot, so the pre-flight passes silently. What it
        // reserves is visible from the other side: it refuses when one is held.
        expect(preflight.trim()).toBe("");

        const held = execSync(
          `PORT=${SLOT} NODE_ENV=development NO_COLOR=1 node -e '
          const net = require("node:net");
          const s = net.createServer().listen(${SLOT + 1000}, "127.0.0.1", () => {
            const { spawnSync } = require("node:child_process");
            const r = spawnSync("bash", ["dev/scripts/check-ports.sh"], { encoding: "utf8" });
            process.stdout.write(String(r.status) + "\\n" + r.stdout);
            s.close();
          });
        '`,
          { encoding: "utf8", cwd: REPO_ROOT },
        );
        expect(held.split("\n")[0]).toBe("1");
        expect(held).toContain(String(SLOT + 1000));
      },
    );
  });
});

describe("given a developer who set the api port explicitly", () => {
  describe("when the launcher derives its ports", () => {
    /** @scenario "A port the developer set themselves is left alone" */
    it("keeps their value and derives nothing over it", () => {
      const ports = derivePorts({ PORT: "5560", API_PORT: "7777" });

      expect(ports.API_PORT).toBe("7777");
      expect(ports.WORKER_METRICS_PORT).toBe("2999");
      expect(ports.GATEWAY_PORT).toBe("5563");
    });

    /** @scenario "Each lane is told the port that was derived for it" */
    it("derives every port from PORT when none is set", () => {
      const ports = derivePorts({ PORT: "5570" });

      expect(ports.APP_PORT).toBe("5570");
      expect(ports.API_PORT).toBe("6570");
      expect(ports.WORKER_METRICS_PORT).toBe("3009");
      expect(ports.GATEWAY_PORT).toBe("5573");
    });
  });
});

describe("given the workspace env file names a port for the browser application", () => {
  describe("when a lane is started with a port the launcher derived", () => {
    /** @scenario "A derived port beats the value committed in the workspace env file" */
    it("binds the derived port, because an env file never overwrites what is already set", () => {
      const envFile = path.join(scratch, ".env");
      writeFileSync(envFile, "PORT=5560\nAPI_PORT=5560\n");

      const stdout = execFileSync(
        process.execPath,
        [
          `--env-file-if-exists=${envFile}`,
          "-e",
          "process.stdout.write(String(process.env.API_PORT))",
        ],
        { encoding: "utf8", env: { ...process.env, API_PORT: "6560" } },
      );

      expect(stdout).toBe("6560");
    });
  });
});
