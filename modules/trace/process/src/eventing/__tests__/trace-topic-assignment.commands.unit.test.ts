import { ASSIGN_TOPIC_COMMAND_TYPE, type AssignTopicCommandData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import type { TraceTopicAssignmentCommand } from "../trace-topic-assignment.commands.ts";
import {
  EventingTraceTopicAdapter,
  EventingTraceTopicAssignment,
} from "../trace-topic-assignment.commands.ts";

class Commands implements TraceTopicAssignmentCommand {
  input: AssignTopicCommandData | null = null;

  async sendAssignTopic(input: AssignTopicCommandData): Promise<void> {
    this.input = input;
  }
}

describe("EventingTraceTopicAssignment", () => {
  it("validates and sends Trace-owned topic assignments through the named command port", async () => {
    const commands = new Commands();
    const assignments = EventingTraceTopicAssignment.create(commands);
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

  /** @scenario "A topic assignment lands on a trace older than the summary read window" */
  it("stamps the topic_assigned event with the command's time, so the fold reads back its trace", async () => {
    const traceOccurredAt = 1_760_000_000_000;
    const [event] = await EventingTraceTopicAdapter.create().handle({
      type: ASSIGN_TOPIC_COMMAND_TYPE,
      tenantId: "tenant_1",
      aggregateId: "trace_1",
      data: {
        tenantId: "tenant_1",
        traceId: "trace_1",
        topicId: "topic_1",
        topicName: null,
        subtopicId: null,
        subtopicName: null,
        isIncremental: true,
        occurredAt: traceOccurredAt,
      },
    } as Parameters<EventingTraceTopicAdapter["handle"]>[0]);

    expect(event?.occurredAt).toBe(traceOccurredAt);
  });
});
