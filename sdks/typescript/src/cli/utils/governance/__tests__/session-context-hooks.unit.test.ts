/**
 * The session context hook entries in the hook file of each agent that takes
 * command hooks: the merge, the ownership rule that keeps a user's own hooks
 * out of it, and the removal logout drives.
 *
 * Feature: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type HookedTool,
  hasSessionContextHooks,
  installSessionContextHooks,
  removeSessionContextHooks,
  sessionContextHookCommand,
  sessionContextHooksTarget,
} from "../session-context-hooks";

let tmpHome: string;
let settingsPath: string;
const origHome = process.env.HOME;
const origUserprofile = process.env.USERPROFILE;
const origCodexHome = process.env.CODEX_HOME;

const entryFor = (tool: HookedTool) => ({
  hooks: [{ type: "command", command: sessionContextHookCommand(tool), timeout: 10 }],
});

const ourEntry = entryFor("claude_code");

// Claude's SessionStart entry additionally carries the guidance hook, in the
// same entry, so it stays one langwatch entry per event.
const ourSessionStartEntry = {
  hooks: [
    {
      type: "command",
      command: sessionContextHookCommand("claude_code"),
      timeout: 10,
    },
    {
      type: "command",
      command: "langwatch ingest guidance claude-code",
      timeout: 10,
    },
  ],
};

const userEntry = {
  matcher: "startup",
  hooks: [{ type: "command", command: "./scripts/greet.sh", timeout: 5 }],
};

const install = ({
  tool = "claude_code",
  filePath,
}: { tool?: HookedTool; filePath?: string } = {}) =>
  installSessionContextHooks({ tool, ...(filePath ? { filePath } : {}) });

const has = (tool: HookedTool = "claude_code") => hasSessionContextHooks({ tool });

const remove = (tool: HookedTool = "claude_code") => removeSessionContextHooks({ tool });

const readSettings = (file = settingsPath): Record<string, any> =>
  JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, any>;

const writeSettings = (settings: unknown): void => {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
};

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "lw-session-hooks-"));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  delete process.env.CODEX_HOME;
  settingsPath = path.join(tmpHome, ".claude", "settings.json");
});

afterEach(() => {
  // Assigning undefined to process.env stores the string "undefined", which
  // then leaks into every later test in this worker.
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  if (origUserprofile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = origUserprofile;
  if (origCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = origCodexHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("installSessionContextHooks", () => {
  describe("given no settings file at all", () => {
    it("creates one carrying a SessionStart and a Stop entry", () => {
      const result = install();

      expect(result.action).toBe("created");
      expect(result.path).toBe(settingsPath);
      expect(result.displayPath).toBe("~/.claude/settings.json");
      expect(readSettings()).toEqual({
        hooks: { SessionStart: [ourSessionStartEntry], Stop: [ourEntry] },
      });
    });

    it("writes json indented by two spaces, ending in a newline", () => {
      install();

      const raw = fs.readFileSync(settingsPath, "utf8");
      expect(raw.endsWith("}\n")).toBe(true);
      expect(raw).toContain('\n  "hooks": {');
    });
  });

  describe("given the hooks are already installed", () => {
    it("reports unchanged and leaves the file byte for byte", () => {
      install();
      const before = fs.readFileSync(settingsPath, "utf8");

      expect(install().action).toBe("unchanged");
      expect(fs.readFileSync(settingsPath, "utf8")).toBe(before);
    });
  });

  describe("given a settings file with the user's own configuration", () => {
    beforeEach(() => {
      writeSettings({
        model: "claude-sonnet-5",
        env: { MY_OWN: "keep" },
        hooks: {
          SessionStart: [userEntry],
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "audit" }] }],
        },
      });
    });

    it("reports updated and keeps every unrelated key verbatim", () => {
      expect(install().action).toBe("updated");

      const settings = readSettings();
      expect(settings.model).toBe("claude-sonnet-5");
      expect(settings.env).toEqual({ MY_OWN: "keep" });
      expect(settings.hooks.PreToolUse).toEqual([
        { matcher: "Bash", hooks: [{ type: "command", command: "audit" }] },
      ]);
    });

    it("leaves the user's own entry first and adds ours beside it", () => {
      install();

      expect(readSettings().hooks.SessionStart).toEqual([userEntry, ourSessionStartEntry]);
      expect(readSettings().hooks.Stop).toEqual([ourEntry]);
    });
  });

  describe("given an entry an older cli wrote", () => {
    it("replaces it rather than leaving two of ours behind", () => {
      writeSettings({
        hooks: {
          SessionStart: [
            userEntry,
            {
              hooks: [{ type: "command", command: "langwatch ingest hook claude" }],
            },
          ],
        },
      });

      expect(install().action).toBe("updated");
      expect(readSettings().hooks.SessionStart).toEqual([userEntry, ourSessionStartEntry]);
    });
  });

  describe("given an explicit file path", () => {
    it("merges into that file instead of the home directory one", () => {
      const custom = path.join(tmpHome, "elsewhere", "settings.json");

      const result = install({ filePath: custom });

      expect(result.action).toBe("created");
      expect(result.path).toBe(custom);
      expect(fs.existsSync(settingsPath)).toBe(false);
    });
  });

  describe("given a settings file that is not valid json", () => {
    /** @scenario "A settings file LangWatch cannot parse is never overwritten" */
    it("refuses to write, leaving the user's file exactly as it was", () => {
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(settingsPath, '{"hooks": {,}');

      expect(() => install()).toThrow(/is not valid JSON/);
      expect(fs.readFileSync(settingsPath, "utf8")).toBe('{"hooks": {,}');
    });
  });

  describe("when the tool is codex", () => {
    it("writes the codex hook command into the codex hooks file", () => {
      const result = install({ tool: "codex" });

      expect(result.path).toBe(path.join(tmpHome, ".codex", "hooks.json"));
      expect(result.displayPath).toBe("~/.codex/hooks.json");
      expect(readSettings(result.path)).toEqual({
        hooks: {
          SessionStart: [entryFor("codex")],
          Stop: [entryFor("codex")],
        },
      });
    });

    it("follows CODEX_HOME when the user relocated the config directory", () => {
      process.env.CODEX_HOME = path.join(tmpHome, "elsewhere");

      expect(sessionContextHooksTarget("codex").path).toBe(
        path.join(tmpHome, "elsewhere", "hooks.json"),
      );
      expect(install({ tool: "codex" }).path).toBe(path.join(tmpHome, "elsewhere", "hooks.json"));
    });

    it("keeps hooks the user already declared in the same file", () => {
      const codexHooks = path.join(tmpHome, ".codex", "hooks.json");
      fs.mkdirSync(path.dirname(codexHooks), { recursive: true });
      fs.writeFileSync(
        codexHooks,
        JSON.stringify({
          description: "mine",
          hooks: { SessionStart: [userEntry] },
        }),
      );

      expect(install({ tool: "codex" }).action).toBe("updated");

      const document = readSettings(codexHooks);
      expect(document.description).toBe("mine");
      expect(document.hooks.SessionStart).toEqual([userEntry, entryFor("codex")]);
    });

    it("leaves the claude settings file alone", () => {
      install({ tool: "codex" });

      expect(fs.existsSync(settingsPath)).toBe(false);
    });
  });
});

describe("hasSessionContextHooks", () => {
  describe("given a settings file with only the user's own hooks", () => {
    it("reports nothing of ours to remove", () => {
      writeSettings({ hooks: { SessionStart: [userEntry] } });

      expect(has()).toBe(false);
    });
  });

  describe("given no settings file", () => {
    it("reports nothing of ours to remove", () => {
      expect(has()).toBe(false);
      expect(has("codex")).toBe(false);
    });
  });

  describe("given the hooks are installed", () => {
    it("reports them present for the tool that has them, and only that one", () => {
      install();

      expect(has()).toBe(true);
      expect(has("codex")).toBe(false);
    });
  });
});

describe("removeSessionContextHooks", () => {
  describe("given our entries beside the user's own", () => {
    it("takes ours, keeps theirs, and leaves no empty containers", () => {
      writeSettings({
        model: "claude-sonnet-5",
        hooks: { SessionStart: [userEntry] },
      });
      install();

      expect(remove()).toBe(true);

      const settings = readSettings();
      expect(settings.hooks).toEqual({ SessionStart: [userEntry] });
      expect(settings.model).toBe("claude-sonnet-5");
    });

    it("drops the hooks key entirely when nothing else was in it", () => {
      writeSettings({ model: "claude-sonnet-5" });
      install();

      expect(remove()).toBe(true);
      expect(readSettings()).toEqual({ model: "claude-sonnet-5" });
    });
  });

  describe("when the tool is codex", () => {
    it("takes our entries out of the codex hooks file", () => {
      install({ tool: "codex" });

      expect(remove("codex")).toBe(true);
      expect(readSettings(path.join(tmpHome, ".codex", "hooks.json"))).toEqual({});
    });
  });

  describe("given nothing of ours to remove", () => {
    it("reports no change for a missing file, and leaves other files alone", () => {
      expect(remove()).toBe(false);

      writeSettings({ hooks: { SessionStart: [userEntry] } });
      const before = fs.readFileSync(settingsPath, "utf8");
      expect(remove()).toBe(false);
      expect(fs.readFileSync(settingsPath, "utf8")).toBe(before);
    });
  });

  describe("given a settings file we cannot parse", () => {
    it("leaves it untouched rather than rewriting what it could not read", () => {
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(settingsPath, '{ "hooks": { "Stop": [ , ] }');

      expect(remove()).toBe(false);
      expect(fs.readFileSync(settingsPath, "utf8")).toBe('{ "hooks": { "Stop": [ , ] }');
    });
  });
});
