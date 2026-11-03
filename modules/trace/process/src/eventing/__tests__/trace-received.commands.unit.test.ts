/**
 * @vitest-environment node
 * @see modules/trace/specs/later-trace-nurturing-signal.feature
 */
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { RecordTraceReceivedCommand } from "../trace-project-milestones.commands.ts";
import {
  RECORD_TRACE_RECEIVED_COMMAND_TYPE,
  type RecordTraceReceivedCommandData,
} from "../trace-project-milestones.events.ts";

function received(occurredAt: number): RecordTraceReceivedCommandData {
  return { tenantId: "project-1", projectId: "project-1", userId: "admin-1", occurredAt };
}

function recorded(payload: RecordTraceReceivedCommandData) {
  return new RecordTraceReceivedCommand().handle({
    tenantId: createTenantId(payload.tenantId),
    aggregateId: RecordTraceReceivedCommand.getAggregateId(payload),
    type: RECORD_TRACE_RECEIVED_COMMAND_TYPE,
    data: payload,
  });
}

describe("RecordTraceReceivedCommand", () => {
  describe("when two later traces in the same project are received", () => {
    /** @scenario "A later trace's fact is keyed by its project and instant" */
    it("keys each fact by the project and its instant, still naming the project", () => {
      const [first] = recorded(received(1_000));
      const [second] = recorded(received(2_000));

      expect(first?.aggregateId).toBe("project-1:1000");
      expect(second?.aggregateId).toBe("project-1:2000");
      expect(first?.data.projectId).toBe("project-1");
    });
  });
});
