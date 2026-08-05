/**
 * The session context hook entries in ~/.claude/settings.json: the merge, the
 * ownership rule that keeps a user's own hooks out of it, and the removal
 * logout drives.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  hasClaudeSessionContextHooks,
  installClaudeSessionContextHooks,
  removeClaudeSessionContextHooks,
  SESSION_CONTEXT_HOOK_COMMAND,
} from "../claude-hooks";

let tmpHome: string;
let settingsPath: string;
const origHome = process.env.HOME;
const origUserprofile = process.env.USERPROFILE;

const ourEntry = {
  hooks: [
    { type: "command", command: SESSION_CONTEXT_HOOK_COMMAND, timeout: 10 },
  ],
};

const userEntry = {
  matcher: "startup",
  hooks: [{ type: "command", command: "./scripts/greet.sh", timeout: 5 }],
};

const readSettings = (): Record<string, any> =>
  JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, any>;

const writeSettings = (settings: unknown): void => {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
};

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "lw-claude-hooks-"));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  settingsPath = path.join(tmpHome, ".claude", "settings.json");
});

afterEach(() => {
  process.env.HOME = origHome;
  process.env.USERPROFILE = origUserprofile;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("installClaudeSessionContextHooks", () => {
  describe("given no settings file at all", () => {
    it("creates one carrying a SessionStart and a Stop entry", () => {
      const result = installClaudeSessionContextHooks();

      expect(result.action).toBe("created");
      expect(result.path).toBe(settingsPath);
      expect(result.displayPath).toBe("~/.claude/settings.json");
      expect(readSettings()).toEqual({
        hooks: { SessionStart: [ourEntry], Stop: [ourEntry] },
      });
    });

    it("writes json indented by two spaces, ending in a newline", () => {
      installClaudeSessionContextHooks();

      const raw = fs.readFileSync(settingsPath, "utf8");
      expect(raw.endsWith("}\n")).toBe(true);
      expect(raw).toContain('\n  "hooks": {');
    });
  });

  describe("given the hooks are already installed", () => {
    it("reports unchanged and leaves the file byte for byte", () => {
      installClaudeSessionContextHooks();
      const before = fs.readFileSync(settingsPath, "utf8");

      expect(installClaudeSessionContextHooks().action).toBe("unchanged");
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
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "audit" }] },
          ],
        },
      });
    });

    it("reports updated and keeps every unrelated key verbatim", () => {
      expect(installClaudeSessionContextHooks().action).toBe("updated");

      const settings = readSettings();
      expect(settings.model).toBe("claude-sonnet-5");
      expect(settings.env).toEqual({ MY_OWN: "keep" });
      expect(settings.hooks.PreToolUse).toEqual([
        { matcher: "Bash", hooks: [{ type: "command", command: "audit" }] },
      ]);
    });

    it("leaves the user's own entry first and adds ours beside it", () => {
      installClaudeSessionContextHooks();

      expect(readSettings().hooks.SessionStart).toEqual([userEntry, ourEntry]);
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
              hooks: [
                { type: "command", command: "langwatch ingest hook claude" },
              ],
            },
          ],
        },
      });

      expect(installClaudeSessionContextHooks().action).toBe("updated");
      expect(readSettings().hooks.SessionStart).toEqual([userEntry, ourEntry]);
    });
  });

  describe("given an explicit file path", () => {
    it("merges into that file instead of the home directory one", () => {
      const custom = path.join(tmpHome, "elsewhere", "settings.json");

      const result = installClaudeSessionContextHooks({ filePath: custom });

      expect(result.action).toBe("created");
      expect(result.path).toBe(custom);
      expect(fs.existsSync(settingsPath)).toBe(false);
    });
  });
});

describe("hasClaudeSessionContextHooks", () => {
  describe("given a settings file with only the user's own hooks", () => {
    it("reports nothing of ours to remove", () => {
      writeSettings({ hooks: { SessionStart: [userEntry] } });

      expect(hasClaudeSessionContextHooks()).toBe(false);
    });
  });

  describe("given no settings file", () => {
    it("reports nothing of ours to remove", () => {
      expect(hasClaudeSessionContextHooks()).toBe(false);
    });
  });

  describe("given the hooks are installed", () => {
    it("reports them present", () => {
      installClaudeSessionContextHooks();

      expect(hasClaudeSessionContextHooks()).toBe(true);
    });
  });
});

describe("removeClaudeSessionContextHooks", () => {
  describe("given our entries beside the user's own", () => {
    it("takes ours, keeps theirs, and leaves no empty containers", () => {
      writeSettings({
        model: "claude-sonnet-5",
        hooks: { SessionStart: [userEntry] },
      });
      installClaudeSessionContextHooks();

      expect(removeClaudeSessionContextHooks()).toBe(true);

      const settings = readSettings();
      expect(settings.hooks).toEqual({ SessionStart: [userEntry] });
      expect(settings.model).toBe("claude-sonnet-5");
    });

    it("drops the hooks key entirely when nothing else was in it", () => {
      writeSettings({ model: "claude-sonnet-5" });
      installClaudeSessionContextHooks();

      expect(removeClaudeSessionContextHooks()).toBe(true);
      expect(readSettings()).toEqual({ model: "claude-sonnet-5" });
    });
  });

  describe("given nothing of ours to remove", () => {
    it("reports no change for a missing file, and leaves other files alone", () => {
      expect(removeClaudeSessionContextHooks()).toBe(false);

      writeSettings({ hooks: { SessionStart: [userEntry] } });
      const before = fs.readFileSync(settingsPath, "utf8");
      expect(removeClaudeSessionContextHooks()).toBe(false);
      expect(fs.readFileSync(settingsPath, "utf8")).toBe(before);
    });
  });

  describe("given a settings file we cannot parse", () => {
    it("leaves it untouched rather than rewriting what it could not read", () => {
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(settingsPath, '{ "hooks": { "Stop": [ , ] }');

      expect(removeClaudeSessionContextHooks()).toBe(false);
      expect(fs.readFileSync(settingsPath, "utf8")).toBe(
        '{ "hooks": { "Stop": [ , ] }',
      );
    });
  });
});
