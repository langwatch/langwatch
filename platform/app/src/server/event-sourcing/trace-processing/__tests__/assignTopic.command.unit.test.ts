import { describe, expect, it } from "vitest";
import { assignTopic } from "../assignTopic.command";
import { TRACE_ID } from "./fixtures";

describe("the assignTopic command", () => {
  it("emits exactly the topicAssigned event", async () => {
    const input = {
      traceId: TRACE_ID,
      topicId: "t-1",
      topicName: "Topic",
      subtopicId: null,
      subtopicName: null,
      isIncremental: false,
      assignedAt: 100,
    };
    expect(await assignTopic(input)).toEqual([
      { type: "topicAssigned", data: input },
    ]);
  });
});
