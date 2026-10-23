/**
 * @vitest-environment node
 * @see modules/coding-agent/specs/coding-agent-session-stored.feature
 */
import { CODING_AGENT_SESSION_STORED_EVENT_TYPE } from "@langwatch/coding-agent-contract";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { RecordCodingAgentSessionStoredCommand } from "../coding-agent-project-milestones.commands.ts";

const data = {
  tenantId: "project-1",
  projectId: "project-1",
  sessionId: "session-1",
  agentType: "claude_code",
  firstForProject: true,
  occurredAt: 1_000,
};

function record(over: Partial<typeof data> = {}) {
  const [event] = new RecordCodingAgentSessionStoredCommand().handle({
    tenantId: createTenantId("project-1"),
    aggregateId: "project-1:1000",
    type: "record",
    data: { ...data, ...over },
  });
  if (!event) throw new Error("the command recorded no event");
  return event;
}

describe("RecordCodingAgentSessionStoredCommand", () => {
  it("records the lw.coding_agent.session_stored event with the data as given", () => {
    const event = record();

    expect([event.type, event.data]).toEqual([CODING_AGENT_SESSION_STORED_EVENT_TYPE, data]);
  });

  it("stamps the event with the session's own time, not the processing time", () => {
    expect(record({ occurredAt: 5_000 }).occurredAt).toBe(5_000);
  });

  describe("when the same session is recorded twice", () => {
    /** @scenario "A redelivered session-stored fact is one event" */
    it("keys both by the project, the session and its time", () => {
      expect(record().idempotencyKey).toBe(record().idempotencyKey);
    });
  });

  describe("when a later session of the project is recorded", () => {
    it("keys it apart from the earlier one", () => {
      expect(record({ sessionId: "session-2" }).idempotencyKey).not.toBe(record().idempotencyKey);
    });
  });
});
