import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { ENABLED_TOOLS, openSessionManager } from "./session.js";

function tempHome(): { home: string; sessionDir: string } {
  const home = mkdtempSync(join(tmpdir(), "langy-session-"));
  return { home, sessionDir: join(home, "sessions") };
}

function userMessage(text: string): UserMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

function assistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "openai",
    model: "gpt-5-mini",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

describe("openSessionManager", () => {
  describe("when a home with no persisted session", () => {
    it("starts fresh and reports resumed false", () => {
      const { home, sessionDir } = tempHome();
      const { sessionManager, resumed } = openSessionManager({ home, sessionDir });
      expect(resumed).toBe(false);
      expect(sessionManager.getEntries()).toHaveLength(0);
    });
  });

  describe("when a home holding a previous session with history", () => {
    /** @scenario A respawned pi worker resumes the conversation's persisted session */
    it("continues that session and reports resumed true", () => {
      const { home, sessionDir } = tempHome();
      const previous = SessionManager.create(home, sessionDir);
      previous.appendMessage(userMessage("find my failing traces"));
      // pi persists the session file only once an assistant message exists (a
      // deliberate no-littering rule), which mirrors reality: only a
      // conversation with at least one completed turn is resumable.
      previous.appendMessage(assistantMessage("Searching now."));

      const { sessionManager, resumed } = openSessionManager({ home, sessionDir });
      expect(resumed).toBe(true);
      expect(sessionManager.getEntries().length).toBeGreaterThan(0);
      expect(sessionManager.getSessionId()).toBe(previous.getSessionId());
    });
  });

  describe("when the previous session file is corrupt", () => {
    /** @scenario A corrupt persisted session degrades to a fresh one instead of failing the spawn */
    it("degrades to a fresh session and reports resumed false", () => {
      const { home, sessionDir } = tempHome();
      const previous = SessionManager.create(home, sessionDir);
      previous.appendMessage(userMessage("hello"));
      previous.appendMessage(assistantMessage("Hi."));
      for (const file of readdirSync(sessionDir)) {
        writeFileSync(join(sessionDir, file), "{ not json\n");
      }

      const { sessionManager, resumed } = openSessionManager({ home, sessionDir });
      expect(resumed).toBe(false);
      expect(sessionManager.getEntries()).toHaveLength(0);
    });
  });
});

describe("ENABLED_TOOLS", () => {
  describe("when the session hands pi its tool allowlist", () => {
    /** @scenario The worker does not expose tools the panel cannot show */
    it("names only the tools Langy's role needs", () => {
      const enabled = new Set<string>(ENABLED_TOOLS);

      // Subagent spawning has no surface in the panel, and pi's own
      // interactive prompt would ask the user through a channel the panel
      // does not render. Neither is on the list, and the list is an
      // allowlist, so nothing else pi ships reaches the model either.
      for (const denied of ["task", "agent", "subagent", "ask", "prompt"]) {
        expect(enabled.has(denied)).toBe(false);
      }
      // The tools the role does need: the shell and file surface the CLI and
      // the GitHub skill run on, the skill tool, the plan channel, and the
      // question tool the panel renders as a choices card.
      for (const tool of [
        "bash",
        "read",
        "edit",
        "write",
        "grep",
        "find",
        "ls",
        "todowrite",
        "skill",
        "question",
      ]) {
        expect(enabled.has(tool)).toBe(true);
      }
    });
  });
});
