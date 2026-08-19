/**
 * The opencode session context plugin: where it lands, the marker that makes it
 * ours, the removal logout drives, and the two promises the generated module
 * makes to the session it runs in (never blocks, never throws).
 *
 * The generated module is exercised for real rather than asserted as a string:
 * a driver imports it in a fresh Node process with a stand-in `langwatch` first
 * on PATH, so a plugin that would fail to parse, fail to load, or spawn the
 * wrong thing inside opencode fails here instead. No module mocking, because a
 * mock that silently missed would run the real CLI.
 *
 * Feature: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  hasOpencodeSessionContextPlugin,
  installOpencodeSessionContextPlugin,
  OPENCODE_HOOK_COMMAND,
  OPENCODE_PLUGIN_FILE_NAME,
  OPENCODE_PLUGIN_MARKER,
  opencodePluginTarget,
  removeOpencodeSessionContextPlugin,
} from "../opencode-plugin";

let tmpHome: string;
let pluginPath: string;
const origHome = process.env.HOME;
const origUserprofile = process.env.USERPROFILE;
const origXdg = process.env.XDG_CONFIG_HOME;

/**
 * Run the generated plugin against one event in a fresh Node process, with
 * `langwatch` on PATH resolving to a script that records its argv and stdin.
 * Returns what that stand-in was invoked with, or null when nothing ran.
 *
 * `expectInvocation` decides how the driver waits, because the plugin never
 * waits itself: expecting one polls for the record, expecting none gives the
 * spawn a grace period and then asserts the absence. Both keep the plugin's
 * own contract intact, which is that its handler resolves without waiting.
 */
const runPluginEvent = ({
  event,
  directory,
  stubExitCode = 0,
  omitStub = false,
  expectInvocation = true,
}: {
  event: unknown;
  directory: string;
  stubExitCode?: number;
  omitStub?: boolean;
  expectInvocation?: boolean;
}): { argv: string[]; stdin: string } | null => {
  const binDir = path.join(tmpHome, "bin");
  const recordPath = path.join(tmpHome, "invocation.json");
  fs.mkdirSync(binDir, { recursive: true });
  fs.rmSync(recordPath, { force: true });

  if (!omitStub) {
    const stub = path.join(binDir, "langwatch");
    fs.writeFileSync(
      stub,
      `#!/usr/bin/env node
const fs = require("node:fs");
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  fs.writeFileSync(
    ${JSON.stringify(recordPath)},
    JSON.stringify({ argv: process.argv.slice(2), stdin: Buffer.concat(chunks).toString("utf8") }),
  );
  process.exit(${stubExitCode});
});
`,
    );
    fs.chmodSync(stub, 0o755);
  }

  const driver = path.join(tmpHome, "driver.mjs");
  fs.writeFileSync(
    driver,
    `import fs from "node:fs";
const module = await import(${JSON.stringify(pathToFileURL(pluginPath).href)});
const factory = Object.values(module).find((value) => typeof value === "function");
const plugin = await factory({ directory: ${JSON.stringify(directory)} });

const startedAt = Date.now();
await plugin.event({ event: ${JSON.stringify(event)} });
const handlerMs = Date.now() - startedAt;
// The handler is what opencode awaits, so it has to return immediately even
// though the child it spawned has not finished. One second is generous.
if (handlerMs > 1000) {
  throw new Error("the event handler blocked for " + handlerMs + "ms");
}

// The plugin never waits on the child, so the driver does.
const record = ${JSON.stringify(recordPath)};
const deadline = Date.now() + ${expectInvocation ? 15_000 : 1_000};
while (Date.now() < deadline) {
  if (fs.existsSync(record)) break;
  await new Promise((resolve) => setTimeout(resolve, 25));
}
`,
  );

  // Without the stub, PATH is the empty bin directory and nothing else, so a
  // langwatch the developer happens to have installed cannot answer instead.
  execFileSync(process.execPath, [driver], {
    env: {
      ...process.env,
      PATH: omitStub ? binDir : `${binDir}:${process.env.PATH ?? ""}`,
    },
    stdio: "pipe",
    timeout: 20_000,
  });

  if (!fs.existsSync(recordPath)) return null;
  return JSON.parse(fs.readFileSync(recordPath, "utf8")) as {
    argv: string[];
    stdin: string;
  };
};

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "lw-opencode-plugin-"));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  delete process.env.XDG_CONFIG_HOME;
  pluginPath = path.join(
    tmpHome,
    ".config",
    "opencode",
    "plugins",
    OPENCODE_PLUGIN_FILE_NAME,
  );
});

afterEach(() => {
  // Assigning undefined to process.env stores the string "undefined", which
  // then leaks into every later test in this worker.
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  if (origUserprofile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = origUserprofile;
  if (origXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = origXdg;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("installOpencodeSessionContextPlugin", () => {
  describe("given no plugin directory at all", () => {
    it("creates the plugin under the opencode plugins directory", () => {
      const result = installOpencodeSessionContextPlugin();

      expect(result.action).toBe("created");
      expect(result.path).toBe(pluginPath);
      expect(result.displayPath).toBe(
        `~/.config/opencode/plugins/${OPENCODE_PLUGIN_FILE_NAME}`,
      );
      expect(fs.readFileSync(pluginPath, "utf8")).toContain(
        OPENCODE_HOOK_COMMAND.split(" ")[0],
      );
    });

    it("follows XDG_CONFIG_HOME when the user relocated the config directory", () => {
      process.env.XDG_CONFIG_HOME = path.join(tmpHome, "elsewhere");

      expect(opencodePluginTarget().path).toBe(
        path.join(
          tmpHome,
          "elsewhere",
          "opencode",
          "plugins",
          OPENCODE_PLUGIN_FILE_NAME,
        ),
      );
    });
  });

  describe("given the plugin is already installed", () => {
    it("reports unchanged and leaves exactly one plugin file", () => {
      installOpencodeSessionContextPlugin();
      const before = fs.readFileSync(pluginPath, "utf8");

      expect(installOpencodeSessionContextPlugin().action).toBe("unchanged");
      expect(fs.readFileSync(pluginPath, "utf8")).toBe(before);
      expect(fs.readdirSync(path.dirname(pluginPath))).toEqual([
        OPENCODE_PLUGIN_FILE_NAME,
      ]);
    });
  });

  describe("given a plugin of the same name somebody else wrote", () => {
    it("leaves it exactly as it was", () => {
      fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
      fs.writeFileSync(pluginPath, "export const Mine = async () => ({});\n");

      expect(installOpencodeSessionContextPlugin().action).toBe("unchanged");
      expect(fs.readFileSync(pluginPath, "utf8")).toBe(
        "export const Mine = async () => ({});\n",
      );
    });
  });
});

describe("hasOpencodeSessionContextPlugin", () => {
  describe("given a plugin file that is not ours", () => {
    it("reports nothing of ours present", () => {
      fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
      fs.writeFileSync(pluginPath, "export const Mine = async () => ({});\n");

      expect(hasOpencodeSessionContextPlugin()).toBe(false);
    });
  });

  describe("given our plugin", () => {
    it("reports it present, by its marker", () => {
      installOpencodeSessionContextPlugin();

      expect(
        fs.readFileSync(pluginPath, "utf8").startsWith(OPENCODE_PLUGIN_MARKER),
      ).toBe(true);
      expect(hasOpencodeSessionContextPlugin()).toBe(true);
    });
  });
});

describe("removeOpencodeSessionContextPlugin", () => {
  describe("given our plugin", () => {
    it("deletes it", () => {
      installOpencodeSessionContextPlugin();

      expect(removeOpencodeSessionContextPlugin()).toBe(true);
      expect(fs.existsSync(pluginPath)).toBe(false);
    });
  });

  describe("given a plugin file that is not ours", () => {
    it("leaves it alone and reports no change", () => {
      fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
      fs.writeFileSync(pluginPath, "export const Mine = async () => ({});\n");

      expect(removeOpencodeSessionContextPlugin()).toBe(false);
      expect(fs.existsSync(pluginPath)).toBe(true);
    });
  });

  describe("given no plugin at all", () => {
    it("reports no change", () => {
      expect(removeOpencodeSessionContextPlugin()).toBe(false);
    });
  });
});

describe("the generated plugin module", () => {
  beforeEach(() => {
    installOpencodeSessionContextPlugin();
  });

  describe("when a session is created", () => {
    /** @scenario "The opencode plugin runs the hook for each session event" */
    it("runs the hook command with the session id and the session's directory", () => {
      const invocation = runPluginEvent({
        directory: "/fallback",
        event: {
          type: "session.created",
          properties: {
            sessionID: "ses_abc",
            info: { id: "ses_abc", directory: "/repo/worktrees/review" },
          },
        },
      });

      expect(invocation).not.toBeNull();
      expect(["langwatch", ...invocation!.argv].join(" ")).toBe(
        OPENCODE_HOOK_COMMAND,
      );
      expect(JSON.parse(invocation!.stdin)).toEqual({
        session_id: "ses_abc",
        cwd: "/repo/worktrees/review",
        hook_event_name: "SessionStart",
      });
    });
  });

  describe("when a session goes idle", () => {
    it("reports the flat session id against the plugin's own directory", () => {
      const invocation = runPluginEvent({
        directory: "/repo/worktrees/review",
        event: { type: "session.idle", properties: { sessionID: "ses_abc" } },
      });

      expect(JSON.parse(invocation!.stdin)).toEqual({
        session_id: "ses_abc",
        cwd: "/repo/worktrees/review",
        hook_event_name: "Stop",
      });
    });
  });

  describe("when an event carries no session id", () => {
    it.each([
      [
        "a session event with empty properties",
        { type: "session.idle", properties: {} },
      ],
      ["an event of another kind", { type: "message.updated" }],
      ["an event with no type at all", {}],
    ])("runs nothing for %s", (_label, event) => {
      expect(
        runPluginEvent({ directory: "/repo", event, expectInvocation: false }),
      ).toBeNull();
    });
  });

  describe("when the hook command is not on PATH", () => {
    /** @scenario "The opencode plugin never fails the session it runs in" */
    it("resolves without throwing, so the session carries on", () => {
      expect(() =>
        runPluginEvent({
          directory: "/repo",
          omitStub: true,
          expectInvocation: false,
          event: {
            type: "session.created",
            properties: { info: { id: "ses_abc" } },
          },
        }),
      ).not.toThrow();
    });
  });

  describe("when the hook command exits non-zero", () => {
    it("resolves without throwing", () => {
      expect(() =>
        runPluginEvent({
          directory: "/repo",
          stubExitCode: 3,
          event: {
            type: "session.created",
            properties: { info: { id: "ses_abc" } },
          },
        }),
      ).not.toThrow();
    });
  });
});
