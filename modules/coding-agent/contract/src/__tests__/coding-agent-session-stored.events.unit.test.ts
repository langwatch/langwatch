/**
 * @vitest-environment node
 * @see modules/coding-agent/specs/coding-agent-session-stored.feature
 */
import { describe, expect, it } from "vitest";

import {
  CODING_AGENT_SESSION_STORED_EVENT_TYPE,
  codingAgentSessionStoredEventDataSchema,
} from "../index.ts";

const fact = {
  tenantId: "project-1",
  projectId: "project-1",
  sessionId: "session-1",
  agentType: "claude_code",
  firstForProject: true,
  occurredAt: 1_000,
};

describe("the coding-agent session-stored fact", () => {
  it("is named lw.coding_agent.session_stored", () => {
    expect(CODING_AGENT_SESSION_STORED_EVENT_TYPE).toBe("lw.coding_agent.session_stored");
  });

  describe("when its schema is read", () => {
    /** @scenario "The session-stored fact carries ids, the agent, the first-session flag, the terminal type and the repo key only" */
    it("names exactly the agreed keys", () => {
      expect(Object.keys(codingAgentSessionStoredEventDataSchema.shape).toSorted()).toEqual([
        "agentType",
        "firstForProject",
        "occurredAt",
        "projectId",
        "repositoryKey",
        "sessionId",
        "tenantId",
        "terminalType",
      ]);
    });

    it("rejects any other key", () => {
      expect(
        codingAgentSessionStoredEventDataSchema.validate({ ...fact, userEmail: "a@b.c" }),
      ).toBe(false);
    });

    it("accepts a fact with the terminal type and the repo key", () => {
      expect(
        codingAgentSessionStoredEventDataSchema.validate({
          ...fact,
          terminalType: "vscode",
          repositoryKey: "a1b2",
        }),
      ).toBe(true);
    });

    /** @scenario "A client's terminal string reaches peers only as one of a closed set" */
    it("rejects a terminal type outside the closed set", () => {
      expect(
        codingAgentSessionStoredEventDataSchema.validate({ ...fact, terminalType: "my-terminal" }),
      ).toBe(false);
    });

    it("accepts a fact recorded before those two existed", () => {
      expect(codingAgentSessionStoredEventDataSchema.validate(fact)).toBe(true);
    });
  });
});
