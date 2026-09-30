/**
 * The launcher against fake CLIs: where it looks, in what order, what it hands
 * over, and that it exits zero whatever it found.
 *
 * Each fake CLI records the argv it was run with into a probe file, so the
 * assertions are about what was RUN rather than about the launcher's source.
 * The recorded location and the PATH entry are two different fakes, which is
 * what makes the order observable.
 *
 * Every case runs with an explicitly constructed environment rather than an
 * extension of this process's own: these tests are frequently run FROM a
 * coding agent, whose `CLAUDECODE` would defeat the misattribution case and
 * whose `HOME` would put the developer's own config in front of the scratch
 * one.
 *
 * Spec: specs/ai-governance/agent-plugin/plugin-package.feature
 */

import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const launcher = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "launch.mjs",
);

interface LauncherRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

let scratch: string;
let home: string;
/** Where the fakes write what they were run with. */
let probe: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "langwatch-launcher-"));
  home = join(scratch, "home");
  mkdirSync(home, { recursive: true });
  probe = join(scratch, "probe.json");
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/**
 * A fake CLI entry script for the recorded-location branch. It records its
 * argv and whatever arrived on stdin, prints what it was told to, and exits
 * how it was told to.
 */
const fakeRecordedEntry = ({
  exitCode = 0,
  stdout = "",
}: { exitCode?: number; stdout?: string } = {}): string => {
  const entry = join(scratch, "recorded", "cli.js");
  mkdirSync(dirname(entry), { recursive: true });
  writeFileSync(
    entry,
    [
      "const fs = require('node:fs');",
      "let stdin = '';",
      "try { stdin = fs.readFileSync(0, 'utf8'); } catch {}",
      `fs.writeFileSync(${JSON.stringify(probe)}, JSON.stringify({ via: 'recorded', argv: process.argv.slice(2), stdin }));`,
      stdout ? `process.stdout.write(${JSON.stringify(stdout)});` : "",
      `process.exit(${exitCode});`,
    ].join("\n"),
  );
  return entry;
};

/** A fake `langwatch` on PATH: a shell script that records its argv. */
const fakePathCli = (): string => {
  const bin = join(scratch, "bin");
  mkdirSync(bin, { recursive: true });
  const script = join(bin, "langwatch");
  writeFileSync(
    script,
    `#!/bin/sh\nprintf '{"via":"path","argv":"%s"}' "$*" > "${probe}"\n`,
  );
  chmodSync(script, 0o755);
  return bin;
};

const writeCliConfig = (location: { node: string; entry: string }): void => {
  mkdirSync(join(home, ".langwatch"), { recursive: true });
  writeFileSync(
    join(home, ".langwatch", "config.json"),
    JSON.stringify({ cli_location: location }),
  );
};

const readProbe = (): { via: string; argv: string | string[]; stdin?: string } | null =>
  existsSync(probe)
    ? (JSON.parse(readFileSync(probe, "utf8")) as { via: string; argv: string[] })
    : null;

/**
 * Run the launcher the way hooks.json does, minus the shell: `node
 * launch.mjs <hook>`, the payload on stdin, an environment built from
 * scratch. `PATH` carries only what the case put there: node's own directory
 * would do, except that a global npm install puts `langwatch` right beside
 * node, which is the one thing these cases must not find by accident.
 */
const runLauncher = ({
  hook,
  path = [],
  env = { CLAUDECODE: "1" },
  payload = { session_id: "session-1", hook_event_name: "SessionStart" },
}: {
  hook: string;
  path?: string[];
  env?: Record<string, string>;
  payload?: unknown;
}): Promise<LauncherRun> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [launcher, hook], {
      cwd: scratch,
      env: {
        PATH: path.join(":"),
        HOME: home,
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });

describe("the launcher's resolution order", () => {
  describe("given a recorded location that exists and a langwatch on PATH", () => {
    /** @scenario "The launcher runs the CLI at its recorded location before the one on PATH" */
    it("runs the recorded entry under the recorded node, with the hook command and the hook's stdin", async () => {
      const entry = fakeRecordedEntry();
      writeCliConfig({ node: process.execPath, entry });
      const bin = fakePathCli();

      const run = await runLauncher({ hook: "session-context", path: [bin] });

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toBe("");
      const ran = readProbe();
      expect(ran?.via).toBe("recorded");
      expect(ran?.argv).toEqual(["ingest", "hook", "claude-code"]);
      expect(JSON.parse(ran?.stdin ?? "{}")).toMatchObject({ session_id: "session-1" });
    });
  });

  describe("given a recorded entry script that no longer exists", () => {
    /** @scenario "The launcher falls through to PATH when the recorded location is stale" */
    it("runs the langwatch on PATH instead", async () => {
      writeCliConfig({
        node: process.execPath,
        entry: join(scratch, "upgraded-away", "cli.js"),
      });
      const bin = fakePathCli();

      const run = await runLauncher({ hook: "session-context", path: [bin] });

      expect(run.exitCode).toBe(0);
      expect(readProbe()).toEqual({ via: "path", argv: "ingest hook claude-code" });
    });

    it("runs the langwatch on PATH when the recorded node binary is the stale one", async () => {
      const entry = fakeRecordedEntry();
      writeCliConfig({ node: join(scratch, "no-such-node"), entry });
      const bin = fakePathCli();

      await runLauncher({ hook: "session-context", path: [bin] });

      expect(readProbe()?.via).toBe("path");
    });
  });

  describe("given a PATH entry whose langwatch cannot be run", () => {
    /** @scenario "The launcher skips a PATH entry whose langwatch cannot be run" */
    it("skips a directory named langwatch and runs the real one further down PATH", async () => {
      const decoy = join(scratch, "decoy-dir");
      mkdirSync(join(decoy, "langwatch"), { recursive: true });
      const bin = fakePathCli();

      const run = await runLauncher({ hook: "session-context", path: [decoy, bin] });

      expect(run.exitCode).toBe(0);
      expect(readProbe()).toEqual({ via: "path", argv: "ingest hook claude-code" });
    });

    it("skips a langwatch with no execute bit and runs the real one further down PATH", async () => {
      const decoy = join(scratch, "decoy-file");
      mkdirSync(decoy, { recursive: true });
      const unrunnable = join(decoy, "langwatch");
      writeFileSync(unrunnable, "#!/bin/sh\nexit 1\n");
      chmodSync(unrunnable, 0o644);
      const bin = fakePathCli();

      const run = await runLauncher({ hook: "session-context", path: [decoy, bin] });

      expect(run.exitCode).toBe(0);
      expect(readProbe()).toEqual({ via: "path", argv: "ingest hook claude-code" });
    });
  });

  describe("given the guidance hook", () => {
    /** @scenario "The launcher maps the guidance hook to the guidance command" */
    it("runs the CLI's guidance command and forwards its stdout", async () => {
      const entry = fakeRecordedEntry({ stdout: '{"hookSpecificOutput":{}}\n' });
      writeCliConfig({ node: process.execPath, entry });

      const run = await runLauncher({ hook: "session-guidance" });

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toBe('{"hookSpecificOutput":{}}\n');
      expect(readProbe()?.argv).toEqual(["ingest", "guidance", "claude-code"]);
    });
  });
});

describe("the launcher's exit-zero guarantee", () => {
  describe("given a CLI that exits non-zero", () => {
    /** @scenario "The launcher exits zero whatever the CLI did" */
    it("still exits zero", async () => {
      const entry = fakeRecordedEntry({ exitCode: 7 });
      writeCliConfig({ node: process.execPath, entry });

      const run = await runLauncher({ hook: "session-context" });

      expect(readProbe()?.via).toBe("recorded");
      expect(run.exitCode).toBe(0);
    });
  });

  describe("given a hook name this launcher does not know", () => {
    /** @scenario "The launcher runs nothing for a hook it does not know" */
    it("runs nothing and exits zero", async () => {
      const bin = fakePathCli();

      const run = await runLauncher({ hook: "session-from-the-future", path: [bin] });

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toBe("");
      expect(readProbe()).toBeNull();
    });
  });

  describe("given an environment without the Claude Code markers", () => {
    /** @scenario "An agent that is not Claude Code is never reported as Claude Code" */
    it("runs nothing and exits zero", async () => {
      const bin = fakePathCli();

      const run = await runLauncher({ hook: "session-context", path: [bin], env: {} });

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toBe("");
      expect(readProbe()).toBeNull();
    });
  });

  describe("given a config file that is not JSON", () => {
    it("falls through to PATH and exits zero", async () => {
      mkdirSync(join(home, ".langwatch"), { recursive: true });
      writeFileSync(join(home, ".langwatch", "config.json"), "{not json");
      const bin = fakePathCli();

      const run = await runLauncher({ hook: "session-context", path: [bin] });

      expect(run.exitCode).toBe(0);
      expect(readProbe()?.via).toBe("path");
    });
  });
});
