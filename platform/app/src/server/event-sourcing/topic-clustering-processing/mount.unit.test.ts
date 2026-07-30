import { describe, expect, it } from "vitest";
import {
  assertTopicClusteringMountsAreLegal,
  topicClusteringRunHistoryMount,
  topicClusteringRunStatusMount,
  topicModelMount,
} from "./mount";

describe("topic-clustering-processing mounts", () => {
  it("does not throw for any of the three fold mounts", () => {
    expect(() => assertTopicClusteringMountsAreLegal()).not.toThrow();
  });

  for (const [name, mount] of [
    ["topicClusteringRunStatus", topicClusteringRunStatusMount],
    ["topicClusteringRunHistory", topicClusteringRunHistoryMount],
    ["topicModel", topicModelMount],
  ] as const) {
    it(`${name} is a fold scoped to one aggregate, backed by a replace store`, () => {
      expect(mount.projection).toBe("fold");
      expect(mount.scope).toBe("aggregate");
      expect(mount.store).toBe("replace");
      expect(mount.collapse).not.toBe("latest");
    });
  }
});
