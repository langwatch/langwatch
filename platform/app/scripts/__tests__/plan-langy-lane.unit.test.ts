/**
 * @vitest-environment node
 *
 * Tests for dev/scripts/lib/plan-langy-lane.sh, sourced the way
 * platform/app/scripts/start.sh sources it: before the launcher decides whether
 * to start the Langy agent manager and on which port.
 *
 * See specs/setup/dev-langy-agent-lane.feature.
 *
 * The planner is bash; we drive it by sourcing it from `bash -s` and reading
 * the decision it exports, the same technique as resolve-nlp-service.unit.test.ts.
 * The two facts the planner cannot cheaply determine, a Go toolchain and a live
 * listener, are overridable functions, so a test states them instead of
 * depending on the machine it runs on.
 */

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PLANNER = path.join(REPO_ROOT, "dev/scripts/lib/plan-langy-lane.sh");

const FULL_ENV = [
  'LANGY_INTERNAL_SECRET="secret"',
  'SESSIONS_ROOT="/tmp/langy/sessions"',
  'LANGY_WORKSPACE_ROOT="/tmp/langy/workspace"',
  "",
].join("\n");

const appDirs: string[] = [];

function appDirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "plan-langy-lane-"));
  appDirs.push(dir);
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), contents);
  }
  return dir;
}

afterEach(() => {
  while (appDirs.length) {
    rmSync(appDirs.pop()!, { recursive: true, force: true });
  }
});

/**
 * Expands the lane command the way the shell that runs it would, so a test can
 * see which value the manager ends up with.
 *
 * The command goes through an unquoted heredoc: bash expands `${VAR:-default}`
 * there and leaves every quote literal, so the command needs no escaping on the
 * way in. Interpolating it into a `bash -c '...'` string would need escaping for
 * both quotes and backslashes, and getting that half right is its own bug.
 */
function expandLaneCommand({
  command,
  env,
}: {
  command: string;
  env: Record<string, string>;
}): string {
  return execSync("bash -s", {
    encoding: "utf8",
    input: `cat <<EOF\n${command}\nEOF\n`,
    stdio: ["pipe", "pipe", "pipe"],
    env: { PATH: process.env.PATH ?? "", ...env },
  });
}

function plan({
  appDir,
  appPort = "5560",
  env = {},
  hasGo = true,
  listening = false,
  hasPython = false,
  python3 = "/usr/bin/python3",
}: {
  appDir: string;
  appPort?: string;
  env?: Record<string, string | undefined>;
  hasGo?: boolean;
  listening?: boolean;
  hasPython?: boolean;
  python3?: string;
}): {
  stdout: string;
  decision: string;
  reason: string;
  port: string;
  agentUrl: string;
  command: string;
  exitCode: number;
} {
  const exports = Object.entries(env)
    .map(([k, v]) =>
      v === undefined
        ? `unset ${k}`
        : `export ${k}='${v.replace(/'/g, "'\\''")}'`,
    )
    .join("\n");
  const script = `
set -e
${exports}
. "${PLANNER}"
_langy_have_go() { return ${hasGo ? 0 : 1}; }
_langy_port_listening() { return ${listening ? 0 : 1}; }
_langy_have_python() { return ${hasPython ? 0 : 1}; }
_langy_python3_path() { printf '%s' "${python3}"; }
plan_langy_lane "${appDir}" "${appPort}"
echo "__DECISION=\${LANGY_LANE_DECISION:-}"
echo "__REASON=\${LANGY_LANE_REASON:-}"
echo "__PORT=\${LANGY_LANE_PORT:-}"
echo "__AGENT_URL=\${OPENCODE_AGENT_URL:-}"
echo "__COMMAND=$(echo '')\$(langy_lane_command '../..' "\${LANGY_LANE_PORT:-0}")"
`;
  let stdout = "";
  let exitCode = 0;
  try {
    stdout = execSync("bash -s", {
      encoding: "utf8",
      input: script,
      stdio: ["pipe", "pipe", "pipe"],
      // Isolate the subprocess env: a developer's own shell often carries
      // OPENCODE_AGENT_URL and the Langy block, and inheriting them would make
      // these assertions depend on the machine.
      env: { PATH: process.env.PATH ?? "" },
    });
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    exitCode = err.status ?? 1;
    stdout = (err.stdout ?? "") + (err.stderr ?? "");
  }
  const read = (key: string) =>
    stdout.match(new RegExp(`__${key}=(.*)`))?.[1] ?? "";

  return {
    stdout,
    decision: read("DECISION"),
    reason: read("REASON"),
    port: read("PORT"),
    agentUrl: read("AGENT_URL"),
    command: read("COMMAND"),
    exitCode,
  };
}

describe("plan-langy-lane.sh", () => {
  describe("given the app's env file pins an agent address", () => {
    /** @scenario "The manager follows the address pinned in the app's env file" */
    it("resolves the pinned address rather than this worktree's port slot", () => {
      const appDir = appDirWith({
        ".env": `OPENCODE_AGENT_URL="http://localhost:8080"\n${FULL_ENV}`,
      });

      const r = plan({ appDir, appPort: "5590" });

      expect(r.exitCode).toBe(0);
      expect(r.agentUrl).toBe("http://localhost:8080");
      expect(r.port).toBe("8080");
    });

    /** @scenario "The manager follows the address pinned in the app's env file" */
    it("names the file it read the address from", () => {
      const appDir = appDirWith({
        ".env": `OPENCODE_AGENT_URL="http://localhost:8080"\n${FULL_ENV}`,
      });

      const r = plan({ appDir });

      expect(r.stdout).toMatch(/from \.env/);
    });

    /** @scenario "A pinned address decides the port the lane sets" */
    it("sets the manager's port to the pinned one", () => {
      const appDir = appDirWith({
        ".env": `OPENCODE_AGENT_URL="http://localhost:8080"\n${FULL_ENV}`,
      });

      const r = plan({ appDir, appPort: "5570" });

      expect(r.decision).toBe("start");
      expect(r.command).toMatch(/PORT="8080"/);
    });

    /** @scenario "An agent address pinned in a file beats one exported for a single run" */
    it("keeps the pinned address over one exported into the shell", () => {
      const appDir = appDirWith({
        ".env": `OPENCODE_AGENT_URL="http://localhost:8080"\n${FULL_ENV}`,
      });

      const r = plan({
        appDir,
        env: { OPENCODE_AGENT_URL: "http://localhost:9999" },
      });

      expect(r.agentUrl).toBe("http://localhost:8080");
    });

    /** @scenario "A commented-out pin is not an agent address" */
    it("treats a commented-out pin as nothing pinned", () => {
      const appDir = appDirWith({
        ".env": `# OPENCODE_AGENT_URL="http://localhost:8080"\n${FULL_ENV}`,
      });

      const r = plan({ appDir, appPort: "5570" });

      expect(r.port).toBe("5574");
    });
  });

  describe("given the haven overlay also pins one", () => {
    /** @scenario "The haven overlay wins over the plain env file for the agent address" */
    it("resolves the overlay's address, the one the app loads last", () => {
      const appDir = appDirWith({
        ".env": `OPENCODE_AGENT_URL="http://localhost:8080"\n${FULL_ENV}`,
        ".env.portless": 'OPENCODE_AGENT_URL="http://127.0.0.1:41234"\n',
      });

      const r = plan({ appDir });

      expect(r.agentUrl).toBe("http://127.0.0.1:41234");
      expect(r.port).toBe("41234");
    });

    /** @scenario "An overlay that clears the agent address is not read past" */
    it("derives the port when the overlay clears the address", () => {
      const appDir = appDirWith({
        ".env": `OPENCODE_AGENT_URL="http://localhost:8080"\n${FULL_ENV}`,
        ".env.portless": "OPENCODE_AGENT_URL=\n",
      });

      const r = plan({ appDir, appPort: "5570" });

      expect(r.port).toBe("5574");
      expect(r.agentUrl).toBe("http://localhost:5574");
    });
  });

  describe("given nothing pins an agent address", () => {
    /** @scenario "Nothing pinned leaves the launcher to derive the manager port slot" */
    it("derives the port from this worktree's slot", () => {
      const appDir = appDirWith({ ".env": FULL_ENV });

      const r = plan({ appDir, appPort: "5590" });

      expect(r.port).toBe("5594");
      expect(r.agentUrl).toBe("http://localhost:5594");
    });

    /** @scenario "The lane sets the manager's port instead of inheriting the app's" */
    it("never gives the manager the port the app is on", () => {
      const appDir = appDirWith({ ".env": FULL_ENV });

      const r = plan({ appDir, appPort: "5570", env: { PORT: "5570" } });

      expect(r.decision).toBe("start");
      expect(r.port).not.toBe("5570");
      expect(r.command).toMatch(/PORT="5574"/);
    });
  });

  describe("given the setup cannot run the manager", () => {
    /** @scenario "A missing Langy env block skips the lane and names the doctor" */
    it("skips naming the missing secret and the doctor that fixes it", () => {
      const appDir = appDirWith({
        ".env": 'SESSIONS_ROOT="/tmp/s"\nLANGY_WORKSPACE_ROOT="/tmp/w"\n',
      });

      const r = plan({ appDir });

      expect(r.decision).toBe("skip");
      expect(r.reason).toMatch(/LANGY_INTERNAL_SECRET/);
      expect(r.reason).toMatch(/langy-local\.sh/);
    });

    /** @scenario "A missing workspace root skips the lane the same way" */
    it("skips naming the missing workspace root", () => {
      const appDir = appDirWith({
        ".env": 'LANGY_INTERNAL_SECRET="s"\nSESSIONS_ROOT="/tmp/s"\n',
      });

      const r = plan({ appDir });

      expect(r.decision).toBe("skip");
      expect(r.reason).toMatch(/LANGY_WORKSPACE_ROOT/);
    });

    /** @scenario "A missing Langy env block skips the lane and names the doctor" */
    it("counts a setting exported into the shell as present", () => {
      const appDir = appDirWith({
        ".env": 'SESSIONS_ROOT="/tmp/s"\nLANGY_WORKSPACE_ROOT="/tmp/w"\n',
      });

      const r = plan({ appDir, env: { LANGY_INTERNAL_SECRET: "from-shell" } });

      expect(r.decision).toBe("start");
    });

    /** @scenario "A setting only the haven overlay carries does not count as present" */
    it("does not count a secret that only the haven overlay carries", () => {
      const appDir = appDirWith({
        ".env": 'SESSIONS_ROOT="/tmp/s"\nLANGY_WORKSPACE_ROOT="/tmp/w"\n',
        ".env.portless": 'LANGY_INTERNAL_SECRET="from-overlay"\n',
      });

      const r = plan({ appDir });

      expect(r.decision).toBe("skip");
      expect(r.reason).toMatch(/LANGY_INTERNAL_SECRET/);
    });

    /** @scenario "No Go toolchain skips the lane with the manual command" */
    it("skips with the make command when Go is not on PATH", () => {
      const appDir = appDirWith({ ".env": FULL_ENV });

      const r = plan({ appDir, hasGo: false });

      expect(r.decision).toBe("skip");
      expect(r.reason).toMatch(/make service svc=langyagent/);
    });
  });

  describe("given a manager is already listening", () => {
    /** @scenario "A manager already listening is reused" */
    it("reuses it rather than starting a second one", () => {
      const appDir = appDirWith({ ".env": FULL_ENV });

      const r = plan({ appDir, appPort: "5570", listening: true });

      expect(r.decision).toBe("skip");
      expect(r.reason).toMatch(/already running on :5574, reusing/);
    });

    /** @scenario "A manager already listening is reused" */
    it("reuses it even when this worktree's env block is incomplete", () => {
      const appDir = appDirWith({ ".env": "" });

      const r = plan({ appDir, listening: true });

      expect(r.decision).toBe("skip");
      expect(r.reason).toMatch(/reusing/);
    });
  });

  describe("given the agent address is not on this machine", () => {
    /** @scenario "An external agent URL leaves the manager alone" */
    it("skips rather than starting a local manager nothing dials", () => {
      const appDir = appDirWith({
        ".env": `OPENCODE_AGENT_URL="https://langy.example.com"\n${FULL_ENV}`,
      });

      const r = plan({ appDir });

      expect(r.decision).toBe("skip");
      expect(r.reason).toMatch(/external/);
    });
  });

  describe("given the developer opted out", () => {
    /** @scenario "The developer can opt out for one stack" */
    it("skips and says the developer asked for it", () => {
      const appDir = appDirWith({ ".env": FULL_ENV });

      const r = plan({ appDir, env: { LANGWATCH_SKIP_LANGY: "1" } });

      expect(r.decision).toBe("skip");
      expect(r.reason).toMatch(/LANGWATCH_SKIP_LANGY=1/);
    });
  });

  describe("given the worker binary the manager spawns", () => {
    /** @scenario "The lane points the manager at the built worker in this checkout" */
    it("tells the manager where the built worker is", () => {
      const appDir = appDirWith({ ".env": FULL_ENV });

      const r = plan({ appDir });

      expect(r.command).toMatch(
        /LANGY_PI_WORKER_BINARY_PATH="\$\{LANGY_PI_WORKER_BINARY_PATH:-.*services\/langyworker\/out\/langy-worker\}"/,
      );
    });

    /** @scenario "The lane points the manager at the built worker in this checkout" */
    it("lets a path set in the environment win", () => {
      const appDir = appDirWith({ ".env": FULL_ENV });

      const r = plan({ appDir });
      const expanded = expandLaneCommand({
        command: r.command,
        env: { LANGY_PI_WORKER_BINARY_PATH: "/opt/mine" },
      });

      expect(expanded).toMatch(/LANGY_PI_WORKER_BINARY_PATH="\/opt\/mine"/);
    });

    /** @scenario "A worker binary that was never built is called out at startup" */
    it("still starts, and says which build a chat needs first", () => {
      // The app dir is a temp dir, so the checkout's built worker is not on the
      // path the planner derives from it, which is the un-built case.
      const appDir = appDirWith({ ".env": FULL_ENV });

      const r = plan({ appDir });

      expect(r.decision).toBe("start");
      expect(r.reason).toMatch(/build:binary/);
    });
  });

  describe("given the command names the worker's model reaches for", () => {
    /** @scenario "A machine with only python3 gets a python that runs it" */
    it("puts a python on the worker's PATH when the machine has only python3", () => {
      const appDir = appDirWith({ ".env": FULL_ENV });

      const r = plan({ appDir, hasPython: false });

      expect(r.command).toMatch(/^PATH="[^"]*langy-shims\/bin:\$PATH" /);
    });

    /** @scenario "A machine with only python3 gets a python that runs it" */
    it("points that python at the python3 already installed", () => {
      const appDir = appDirWith({ ".env": FULL_ENV });

      const r = plan({
        appDir,
        hasPython: false,
        python3: "/opt/homebrew/bin/python3",
      });
      const shimDir = r.command.match(/^PATH="([^:]*)/)?.[1] ?? "";
      const target = execSync(`readlink ${shimDir}/python`, {
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "" },
      }).trim();

      expect(target).toBe("/opt/homebrew/bin/python3");
    });

    /** @scenario "A machine that has its own python is left alone" */
    it("adds nothing to the PATH when the machine already has a python", () => {
      const appDir = appDirWith({ ".env": FULL_ENV });

      const r = plan({ appDir, hasPython: true });

      expect(r.command).not.toMatch(/^PATH=/);
      expect(r.command).toMatch(/^PORT=/);
    });
  });

  describe("given a lane that will start", () => {
    describe("when the lane is started", () => {
      /** @scenario "The lane caps the pool and reaps idle workers quickly" */
      it("caps the worker pool to the local size", () => {
        const appDir = appDirWith({ ".env": FULL_ENV });

        const r = plan({ appDir });

        expect(r.command).toMatch(
          /LANGY_MAX_WORKERS="\$\{LANGY_MAX_WORKERS:-2\}"/,
        );
      });

      /** @scenario "The lane caps the pool and reaps idle workers quickly" */
      it("reaps an idle worker in minutes rather than the production wait", () => {
        const appDir = appDirWith({ ".env": FULL_ENV });

        const r = plan({ appDir });

        expect(r.command).toMatch(
          /LANGY_WORKER_IDLE_MS="\$\{LANGY_WORKER_IDLE_MS:-120000\}"/,
        );
        expect(r.command).toMatch(/svc=langyagent/);
      });

      /** @scenario "The lane caps the pool and reaps idle workers quickly" */
      it("lets a cap set in the environment win over the local default", () => {
        const appDir = appDirWith({ ".env": FULL_ENV });

        const r = plan({ appDir, env: { LANGY_MAX_WORKERS: "8" } });

        // The lane expands the override where it runs, so the local number is
        // only a fallback and the developer's value survives.
        const expanded = expandLaneCommand({
          command: r.command,
          env: { LANGY_MAX_WORKERS: "8" },
        });

        expect(expanded).toMatch(/LANGY_MAX_WORKERS="8"/);
      });
    });
  });
});
