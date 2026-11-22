import { describe, expect, it } from "vitest";

import { sessionDisplayName } from "../session-display-name.ts";

/** Noon on 21 November in the host zone, so the formatted day is the 21st anywhere. */
const NOV_21 = new Date(2026, 10, 21, 12).getTime();

describe("sessionDisplayName", () => {
  describe("given a session with a name a person gave or typed", () => {
    it("shows that name", () => {
      expect(
        sessionDisplayName({
          title: "Fix the retry loop",
          agent: "claude_code",
          startedAtMs: NOV_21,
        }),
      ).toEqual({ text: "Fix the retry loop", isFallback: false });
    });
  });

  describe("given a session stored with a heading as its name", () => {
    /** @scenario A stored name that reads as a markdown heading or a tag is not shown */
    it("names it by its agent and day instead", () => {
      const name = sessionDisplayName({
        title: "## Your skills",
        agent: "claude_code",
        startedAtMs: NOV_21,
      });
      expect(name.isFallback).toBe(true);
      expect(name.text).toMatch(/^Claude Code session · Nov 21/);
    });
  });

  describe("given an agent this build does not know", () => {
    it("uses the raw agent name, or a generic one when there is none", () => {
      expect(sessionDisplayName({ title: null, agent: "aider", startedAtMs: NOV_21 }).text).toMatch(
        /^aider session/,
      );
      expect(sessionDisplayName({ title: null, agent: "", startedAtMs: NOV_21 }).text).toMatch(
        /^Coding agent session/,
      );
    });
  });
});
