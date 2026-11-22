/** @see specs/coding-agent/sessions-screen.feature */
import { describe, expect, it } from "vitest";

import { findSessionLink, sessionOfLink, withoutSessionLink } from "../session-link.ts";

const row = (sessionId: string, title: string | null, lastUpdateAtMs: number) => ({
  sessionId,
  title,
  lastUpdateAtMs,
});

describe("the session link", () => {
  it("names a session by id before a name", () => {
    expect(findSessionLink({ session: "s1", sessionName: "Scout" })).toEqual({
      kind: "id",
      sessionId: "s1",
      sessionName: "Scout",
    });
    expect(findSessionLink({ session: "s1" })).toEqual({ kind: "id", sessionId: "s1" });
    expect(findSessionLink({ sessionName: " Scout " })).toEqual({
      kind: "name",
      sessionName: "Scout",
    });
    expect(findSessionLink({ session: "", langy: "open" })).toBeNull();
  });

  it("picks the newest listed session with the name", () => {
    const rows = [row("old", "Scout", 1), row("new", "Scout", 5), row("other", "Pip", 9)];

    expect(sessionOfLink({ link: { kind: "name", sessionName: "Scout" }, rows })?.sessionId).toBe(
      "new",
    );
    expect(sessionOfLink({ link: { kind: "id", sessionId: "other" }, rows })?.sessionId).toBe(
      "other",
    );
    expect(sessionOfLink({ link: { kind: "name", sessionName: "Ghost" }, rows })).toBeNull();
  });

  /** @scenario "A link with a session id and a name falls back to the name" */
  it("falls back to the newest session with the name when the id is not listed", () => {
    const rows = [row("old", "Scout", 1), row("new", "Scout", 5)];
    const link = findSessionLink({ session: "agent-1", sessionName: "Scout" });

    expect(link && sessionOfLink({ link, rows })?.sessionId).toBe("new");
    expect(sessionOfLink({ link: { kind: "id", sessionId: "agent-1" }, rows })).toBeNull();
    expect(
      sessionOfLink({ link: { kind: "id", sessionId: "old", sessionName: "Scout" }, rows })
        ?.sessionId,
    ).toBe("old");
  });

  /** @scenario "A session link keeps the Langy question beside it" */
  it("removes only its own keys, so Langy's question stays for Langy", () => {
    const query = { session: "s1", langy: "open", langyPrompt: "Why so many tokens?" };

    expect({ ...query, ...withoutSessionLink() }).toEqual({
      session: undefined,
      sessionName: undefined,
      langy: "open",
      langyPrompt: "Why so many tokens?",
    });
  });
});
