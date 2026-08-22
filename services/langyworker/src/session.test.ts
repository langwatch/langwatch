import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { openSessionManager } from "./session.js";

function tempHome(): { home: string; sessionDir: string } {
  const home = mkdtempSync(join(tmpdir(), "langy-session-"));
  return { home, sessionDir: join(home, "sessions") };
}

describe("openSessionManager", () => {
  describe("given a home with no persisted session", () => {
    it("starts fresh and reports resumed false", () => {
      const { home, sessionDir } = tempHome();
      const { sessionManager, resumed } = openSessionManager({ home, sessionDir });
      expect(resumed).toBe(false);
      expect(sessionManager.getEntries()).toHaveLength(0);
    });
  });

  describe("given a home holding a previous session with history", () => {
    /** @scenario A respawned pi worker resumes the session its home still holds */
    it("continues that session and reports resumed true", () => {
      const { home, sessionDir } = tempHome();
      const previous = SessionManager.create(home, sessionDir);
      previous.appendMessage({
        role: "user",
        content: [{ type: "text", text: "find my failing traces" }],
        timestamp: Date.now(),
      } as never);
      // pi persists the session file only once an assistant message exists (a
      // deliberate no-littering rule), which mirrors reality: only a
      // conversation with at least one completed turn is resumable.
      previous.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "Searching now." }],
        timestamp: Date.now(),
      } as never);

      const { sessionManager, resumed } = openSessionManager({ home, sessionDir });
      expect(resumed).toBe(true);
      expect(sessionManager.getEntries().length).toBeGreaterThan(0);
      expect(sessionManager.getSessionId()).toBe(previous.getSessionId());
    });
  });

  describe("given the previous session file is corrupt", () => {
    /** @scenario A corrupt persisted session degrades to a fresh one instead of failing the spawn */
    it("degrades to a fresh session and reports resumed false", () => {
      const { home, sessionDir } = tempHome();
      const previous = SessionManager.create(home, sessionDir);
      previous.appendMessage({
        role: "user",
        content: [{ type: "text", text: "hello" }],
        timestamp: Date.now(),
      } as never);
      previous.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "Hi." }],
        timestamp: Date.now(),
      } as never);
      for (const file of readdirSync(sessionDir)) {
        writeFileSync(join(sessionDir, file), "{ not json\n");
      }

      const { sessionManager, resumed } = openSessionManager({ home, sessionDir });
      expect(resumed).toBe(false);
      expect(sessionManager.getEntries()).toHaveLength(0);
    });
  });
});
