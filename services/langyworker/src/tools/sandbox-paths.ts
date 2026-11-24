/**
 * The sandbox file tools take a path as text, with no shell in between, so a
 * path copied from a shell line ("$HOME/work/repo/main.py") named a folder
 * called "$HOME". The tools on the user's machine keep their path as written.
 */

import { join } from "node:path";

import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";

import { SANDBOX_FILE_TOOL_NAMES } from "./local-workspace.js";

const HOME_PREFIX = /^(?:\$HOME|\$\{HOME\}|~)(?=$|\/)/;

/** The path with a leading `$HOME`, `${HOME}` or `~` replaced by the sandbox home. */
export function expandSandboxHome({ path, home }: { path: string; home: string }): string {
  const trimmed = path.trim();
  const match = HOME_PREFIX.exec(trimmed);
  if (!match) return path;
  const rest = trimmed.slice(match[0].length).replace(/^\/+/, "");
  return rest === "" ? home : join(home, rest);
}

const SANDBOX_FILE_TOOLS: ReadonlySet<string> = new Set(SANDBOX_FILE_TOOL_NAMES);

export function createSandboxPathsExtension({ home }: { home: string }): InlineExtension {
  return {
    name: "langy-sandbox-paths",
    factory: (pi: ExtensionAPI) => {
      pi.on("tool_call", async (event) => {
        if (!SANDBOX_FILE_TOOLS.has(event.toolName)) return undefined;
        const input = event.input as { path?: unknown };
        if (typeof input.path === "string") {
          input.path = expandSandboxHome({ path: input.path, home });
        }
        return undefined;
      });
    },
  };
}
