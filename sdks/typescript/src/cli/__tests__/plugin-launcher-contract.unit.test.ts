/**
 * The contracts the Claude Code plugin's launcher shares with this CLI.
 *
 * `plugins/langwatch/scripts/launch.mjs` runs the CLI for every plugin hook.
 * It shares no code with the CLI, on purpose: importing anything from here
 * would bring a bundle and a build step back into the plugin. What it shares
 * instead are two contracts, each written as one constant at the top of the
 * launcher: where the CLI keeps its config and which field records the CLI's
 * own location, and which CLI command each hook event runs. This suite reads
 * those constants out of the launcher file and asserts them against the SDK's
 * own, so drift fails a test rather than a session.
 *
 * The second half is the cross-version contract the launcher rests on: the
 * two hook commands accept and ignore options and arguments they do not know
 * and exit zero, so a plugin hooks.json from any version runs with a CLI from
 * any version.
 *
 * Spec: specs/ai-governance/agent-plugin/plugin-package.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vm from "node:vm";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configPath, loadConfig } from "../utils/governance/config";
import { recordCliLocation } from "../utils/governance/cli-location";
import { defaultStateDir } from "../utils/governance/hook-state";
import { SESSION_CONTEXT_GUIDANCE } from "../utils/governance/session-guidance";
import { installSessionContextHooks } from "../utils/governance/session-context-hooks";

const { hookCommandMock } = vi.hoisted(() => ({ hookCommandMock: vi.fn() }));

vi.mock("../commands/ingestion/hook.js", () => ({
  hookCommand: hookCommandMock,
}));

// buildProgram() reads the tsup-injected __CLI_VERSION__ build constant, which
// no test runner defines (see help-topic.unit.test.ts).
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

const launcherPath = path.resolve(
  __dirname,
  "../../../../../plugins/langwatch/scripts/launch.mjs",
);

interface LauncherConfigContract {
  envVar: string;
  path: string[];
  locationField: string;
  stateDir: string[];
}

/** One `const NAME = {...};` literal from the launcher, evaluated on its own. */
function launcherConstant<T>(name: string): T {
  const source = fs.readFileSync(launcherPath, "utf8");
  const match = new RegExp(`const ${name} = (\\{[\\s\\S]*?\\});`).exec(source);
  if (!match) throw new Error(`${name} is not declared in ${launcherPath}`);
  return vm.runInNewContext(`(${match[1]})`) as T;
}

let tmpDir: string;
let savedConfigEnv: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-launcher-contract-"));
  savedConfigEnv = process.env.LANGWATCH_CLI_CONFIG;
});

afterEach(() => {
  if (savedConfigEnv === undefined) delete process.env.LANGWATCH_CLI_CONFIG;
  else process.env.LANGWATCH_CLI_CONFIG = savedConfigEnv;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("the launcher's config contract", () => {
  const contract = launcherConstant<LauncherConfigContract>("CLI_CONFIG");

  describe("given the environment variable the launcher honours", () => {
    it("is the one configPath() honours", () => {
      const override = path.join(tmpDir, "elsewhere.json");
      process.env[contract.envVar] = override;
      expect(configPath()).toBe(override);
    });
  });

  describe("given no override", () => {
    it("names the same file under the home directory, and the same state directory beside it", () => {
      delete process.env.LANGWATCH_CLI_CONFIG;
      expect(configPath()).toBe(path.join(os.homedir(), ...contract.path));
      expect(defaultStateDir()).toBe(
        path.join(path.dirname(configPath()), ...contract.stateDir),
      );
    });
  });

  describe("given the field the launcher reads the CLI location from", () => {
    it("is the field recordCliLocation() writes, in the shape the launcher reads", () => {
      process.env.LANGWATCH_CLI_CONFIG = path.join(tmpDir, "config.json");
      const location = { node: process.execPath, entry: __filename };

      expect(recordCliLocation({ location })).toBe(true);

      const raw = JSON.parse(fs.readFileSync(configPath(), "utf8")) as Record<
        string,
        unknown
      >;
      expect(raw[contract.locationField]).toEqual(location);
      expect(loadConfig().cli_location).toEqual(location);
    });
  });
});

describe("the launcher's command contract", () => {
  const commands = launcherConstant<Record<string, string[]>>("CLI_COMMANDS");

  describe("given the commands the raw claude hooks run", () => {
    it("are exactly the commands the launcher runs, one per hook event", () => {
      const hooksFile = path.join(tmpDir, "settings.json");
      installSessionContextHooks({ tool: "claude_code", filePath: hooksFile });
      const settings = JSON.parse(fs.readFileSync(hooksFile, "utf8")) as {
        hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
      };
      const rawCommands = settings.hooks.SessionStart!.flatMap((group) =>
        group.hooks.map((hook) => hook.command),
      );

      expect(Object.keys(commands).sort()).toEqual([
        "session-context",
        "session-guidance",
      ]);
      expect(rawCommands.sort()).toEqual(
        Object.values(commands)
          .map((argv) => `langwatch ${argv.join(" ")}`)
          .sort(),
      );
    });
  });
});

let stdout: string[] = [];
let exited: number[] = [];

const parse = async (argv: string[]): Promise<void> => {
  stdout = [];
  exited = [];
  hookCommandMock.mockReset();
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exited.push(code ?? 0);
    return undefined as never;
  }) as never);
  const { buildProgram } = await import("../program.js");
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(argv, { from: "user" });
};

describe("the cross-version contract of the hook commands", () => {
  const commands = launcherConstant<Record<string, string[]>>("CLI_COMMANDS");

  describe("given a plugin from a later version passing arguments this CLI does not know", () => {
    /** @scenario "The session context hook command accepts and ignores arguments it does not know" */
    it("runs the session context hook for the named agent and says nothing", async () => {
      await parse([
        ...commands["session-context"]!,
        "--from-the-future",
        "extra",
        "--and=more",
      ]);

      expect(hookCommandMock).toHaveBeenCalledTimes(1);
      expect(hookCommandMock).toHaveBeenCalledWith({ tool: "claude-code" });
      expect(stdout).toEqual([]);
      expect(exited).toEqual([]);
    });

    /** @scenario "The guidance command accepts and ignores arguments it does not know" */
    it("prints the guidance JSON and exits zero", async () => {
      await parse([
        ...commands["session-guidance"]!,
        "--from-the-future",
        "extra",
      ]);

      expect(exited).toEqual([]);
      expect(stdout).toHaveLength(1);
      const parsed = JSON.parse(stdout[0]!) as {
        hookSpecificOutput: { hookEventName: string; additionalContext: string };
      };
      expect(parsed.hookSpecificOutput).toEqual({
        hookEventName: "SessionStart",
        additionalContext: SESSION_CONTEXT_GUIDANCE,
      });
    });
  });
});
