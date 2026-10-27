/**
 * Hook payloads as real agents write them.
 * Feature: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import { describe, expect, it } from "vitest";

import { parseHookInput } from "../hook-input";
import captured from "./fixtures/copilot-hook-payloads.json";

describe("parseHookInput", () => {
  describe("given the hook payloads captured from the Copilot CLI 1.0.100", () => {
    const cli = captured["copilot-cli"];

    describe("when the session starts", () => {
      /** @scenario "A Copilot CLI hook payload yields its session id and directory" */
      it("reads the session id it spells sessionId, and the directory", () => {
        expect(parseHookInput(JSON.stringify(cli.sessionStart))).toEqual({
          sessionId: cli.sessionStart.sessionId,
          cwd: cli.sessionStart.cwd,
        });
      });
    });

    describe("when the agent stops", () => {
      /** @scenario "A Copilot CLI hook payload yields its session id and directory" */
      it("reads the same session id and directory, with no event name to read", () => {
        expect(parseHookInput(JSON.stringify(cli.agentStop))).toEqual({
          sessionId: cli.agentStop.sessionId,
          cwd: cli.agentStop.cwd,
        });
      });
    });
  });

  describe("given a payload carrying both spellings of the session id", () => {
    it("reads session_id, the spelling every other seam agrees on", () => {
      expect(
        parseHookInput(JSON.stringify({ session_id: "snake-id", sessionId: "camel-id" })),
      ).toEqual({ sessionId: "snake-id" });
    });

    it("falls back to sessionId when session_id is blank", () => {
      expect(parseHookInput(JSON.stringify({ session_id: " ", sessionId: "camel-id" }))).toEqual({
        sessionId: "camel-id",
      });
    });
  });

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
      it("reads the session id, the directory and the event as Claude Code's Stop", () => {
        expect(parseHookInput(JSON.stringify(vscode.agentStop))).toEqual({
          sessionId: vscode.agentStop.session_id,
          cwd: vscode.agentStop.cwd,
          hookEventName: "Stop",
        });
      });
    });
  });
});
