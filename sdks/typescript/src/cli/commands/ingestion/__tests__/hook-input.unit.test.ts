/**
 * Hook payloads as real agents write them.
 * Feature: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import { describe, expect, it } from "vitest";

import { parseHookInput } from "../hook-input";
import captured from "./fixtures/copilot-hook-payloads.json";

describe("parseHookInput", () => {
  describe("given the hook payloads captured from VS Code Copilot Chat 0.67", () => {
    const vscode = captured["copilot-vscode"];

    describe("when the session starts", () => {
      /** @scenario "A VS Code Copilot hook payload reads like Claude Code's" */
      it("reads the session id, the directory and the event name", () => {
        expect(parseHookInput(JSON.stringify(vscode.sessionStart))).toEqual({
          sessionId: vscode.sessionStart.session_id,
          cwd: vscode.sessionStart.cwd,
          hookEventName: "SessionStart",
        });
      });
    });

    describe("when the agent stops", () => {
      /** @scenario "A VS Code Copilot hook payload reads like Claude Code's" */
      it("reads the event as Claude Code's Stop", () => {
        expect(parseHookInput(JSON.stringify(vscode.agentStop)).hookEventName).toBe("Stop");
      });
    });
  });
});
