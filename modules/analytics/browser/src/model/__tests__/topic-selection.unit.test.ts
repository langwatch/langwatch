import { describe, expect, it } from "vitest";

import {
  orderByCountThenName,
  readListParam,
  toggleSubtopic,
  toggleTopic,
  toListParam,
} from "../topic-selection.ts";

const SUBTOPICS = [
  { id: "s1", parentId: "t1" },
  { id: "s2", parentId: "t1" },
  { id: "s3", parentId: "t2" },
];

describe("topic selection", () => {
  it("reads and writes the comma-separated query value", () => {
    expect(readListParam(undefined)).toEqual([]);
    expect(readListParam("")).toEqual([]);
    expect(readListParam("a,b")).toEqual(["a", "b"]);
    expect(readListParam(["a", "b"])).toEqual(["a", "b"]);
    expect(toListParam([])).toBeUndefined();
    expect(toListParam(["a", "b"])).toBe("a,b");
  });

  it("ticks a topic without touching its subtopics", () => {
    expect(
      toggleTopic({
        selection: { topics: ["t2"], subtopics: ["s1"] },
        topicId: "t1",
        checked: true,
        subtopicCounts: SUBTOPICS,
      }),
    ).toEqual({ topics: ["t2", "t1"], subtopics: ["s1"] });
  });

  it("unticking a topic drops its subtopics, and keeps them while counts are unknown", () => {
    const selection = { topics: ["t1", "t2"], subtopics: ["s1", "s3", "s2"] };
    expect(
      toggleTopic({ selection, topicId: "t1", checked: false, subtopicCounts: SUBTOPICS }),
    ).toEqual({ topics: ["t2"], subtopics: ["s3"] });
    expect(
      toggleTopic({ selection, topicId: "t1", checked: false, subtopicCounts: undefined }),
    ).toEqual({ topics: ["t2"], subtopics: ["s1", "s3", "s2"] });
  });

  it("ticks and unticks a subtopic", () => {
    expect(toggleSubtopic({ subtopics: ["s1"], subtopicId: "s2", checked: true })).toEqual([
      "s1",
      "s2",
    ]);
    expect(toggleSubtopic({ subtopics: ["s1", "s2"], subtopicId: "s1", checked: false })).toEqual([
      "s2",
    ]);
  });

  it("orders the most counted first, then by name", () => {
    const ordered = orderByCountThenName([
      { name: "b", count: 2 },
      { name: "a", count: 2 },
      { name: "c", count: 9 },
    ]);
    expect(ordered.map((t) => t.name)).toEqual(["c", "a", "b"]);
  });
});
