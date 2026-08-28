import type { AssignTopicCommandData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { EventingTraceTopicAssignmentPort } from "../src/adapters/eventing.trace-topic.adapter";
import { TraceTopicAssignmentCommandPort } from "../src/ports/trace-topic-assignment-command.port";

class Commands extends TraceTopicAssignmentCommandPort {
  input: AssignTopicCommandData | null = null;

  async sendAssignTopic(input: AssignTopicCommandData): Promise<void> {
    this.input = input;
  }
}

describe("EventingTraceTopicAssignmentPort", () => {
  it("validates and sends Trace-owned topic assignments through the named command port", async () => {
    const commands = new Commands();
    const assignments = EventingTraceTopicAssignmentPort.create(commands);
    const input: AssignTopicCommandData = {
      tenantId: "tenant_1",
      traceId: "trace_1",
      topicId: "topic_1",
      topicName: "Support",
      subtopicId: null,
      subtopicName: null,
      isIncremental: true,
      occurredAt: 123,
    };

    await assignments.assignTopic(input);

    expect(commands.input).toEqual(input);
  });
});
