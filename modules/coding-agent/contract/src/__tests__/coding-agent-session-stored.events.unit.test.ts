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
    /** @scenario "The session-stored fact carries ids, the agent and the first-session flag only" */
    it("names exactly the six agreed keys", () => {
      expect(Object.keys(codingAgentSessionStoredEventDataSchema.shape).toSorted()).toEqual([
        "agentType",
        "firstForProject",
        "occurredAt",
        "projectId",
        "sessionId",
        "tenantId",
      ]);
    });

    it("rejects a key outside the agreed six", () => {
      expect(
        codingAgentSessionStoredEventDataSchema.validate({ ...fact, userEmail: "a@b.c" }),
      ).toBe(false);
    });

    it("accepts the six keys", () => {
      expect(codingAgentSessionStoredEventDataSchema.validate(fact)).toBe(true);
    });
  });
});
