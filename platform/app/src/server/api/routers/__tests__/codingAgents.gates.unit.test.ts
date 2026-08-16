/**
 * @vitest-environment node
 * @unit
 *
 * What a reader of the coding-agent surfaces gets to see: the generated title
 * follows content visibility, spend follows cost:view, and both are decided at
 * the read boundary rather than in the services that produce the rows.
 *
 * @see specs/coding-agent/sessions-screen.feature
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { describe, expect, it } from "vitest";
import type { Protections } from "~/server/traces/protections";
import {
  gatePullRequestSessionTitles,
  gateSessionListCost,
  gateSessionListTitles,
} from "../codingAgents.gates";

const FULL: Protections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

function sessionListRow(over: Record<string, unknown> = {}) {
  return {
    sessionId: "session-a",
    title: "Add the sessions screen",
    agent: "claude_code",
    inputTokens: 100,
    costUsd: 12.5 as number | null,
    ...over,
  };
}

describe("the coding-agent read gates", () => {
  describe("given a viewer who may read the project's captured content", () => {
    it("leaves every title where it is", () => {
      const rows = gateSessionListTitles({
        rows: [sessionListRow()],
        protections: FULL,
      });

      expect(rows[0]?.title).toBe("Add the sessions screen");
    });
  });

  describe("given a viewer who may not read the project's captured content", () => {
    /** @scenario "A viewer who may not read captured content gets no session title" */
    it("blanks every title and leaves the rest of the row intact", () => {
      for (const protections of [
        { ...FULL, canSeeCapturedInput: false },
        { ...FULL, canSeeCapturedOutput: false },
        { ...FULL, canSeeCapturedInput: false, canSeeCapturedOutput: false },
      ] satisfies Protections[]) {
        const rows = gateSessionListTitles({
          rows: [sessionListRow()],
          protections,
        });

        // Both sides are required: a title paraphrases the prompt and the
        // reply together, so a viewer allowed one could read the other in it.
        expect(rows[0]?.title).toBeNull();
        expect(rows[0]?.sessionId).toBe("session-a");
        expect(rows[0]?.inputTokens).toBe(100);
        expect(rows[0]?.costUsd).toBe(12.5);
      }
    });
  });

  describe("given a viewer without permission to price the project", () => {
    /** @scenario "A viewer who may not price the project reads its sessions without their cost" */
    it("reports the tokens with no cost", () => {
      const rows = gateSessionListCost({
        rows: [sessionListRow()],
        protections: { ...FULL, canSeeCosts: false },
      });

      // Nulled rather than zeroed: zero would read as "this session was free".
      expect(rows[0]?.costUsd).toBeNull();
      expect(rows[0]?.inputTokens).toBe(100);
      expect(rows[0]?.title).toBe("Add the sessions screen");
    });
  });

  describe("given a viewer who may price the project", () => {
    it("leaves the cost where it is", () => {
      const rows = gateSessionListCost({
        rows: [sessionListRow()],
        protections: FULL,
      });

      expect(rows[0]?.costUsd).toBe(12.5);
    });
  });

  describe("given a pull request whose sessions span two projects", () => {
    /** @scenario "A session whose project hides captured content is listed without its title" */
    it("keeps the title of the readable project and blanks the other", () => {
      const sessions = gatePullRequestSessionTitles({
        sessions: [
          {
            projectId: "project-1",
            title: "Add the sessions screen",
            totalTokens: 10,
          },
          {
            projectId: "project-2",
            title: "Something the reader may not read",
            totalTokens: 20,
          },
        ],
        contentProjectIds: new Set(["project-1"]),
      });

      expect(sessions[0]?.title).toBe("Add the sessions screen");
      expect(sessions[1]?.title).toBeNull();
      // Only the title moves: the numbers are facts about a run, not content.
      expect(sessions.map((session) => session.totalTokens)).toEqual([10, 20]);
    });
  });
});
