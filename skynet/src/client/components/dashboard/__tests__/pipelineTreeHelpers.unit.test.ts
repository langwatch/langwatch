import { describe, expect, it } from "vitest";
import type { PipelineNode } from "../../../../shared/types.ts";
import { buildPauseKey, isPausedKey, isInheritedPause, collectLeafNames } from "../pipelineTreeHelpers.ts";

function makeNode(overrides: Partial<PipelineNode> = {}): PipelineNode {
  return { name: "test", pending: 0, active: 0, blocked: 0, children: [], ...overrides };
}

describe("buildPauseKey", () => {
  it("joins ancestors with name using /", () => {
    expect(buildPauseKey({ ancestors: ["ingestion", "projection"], name: "trace" }))
      .toBe("ingestion/projection/trace");
  });

  it("returns just name when no ancestors", () => {
    expect(buildPauseKey({ ancestors: [], name: "ingestion" }))
      .toBe("ingestion");
  });
});

describe("isPausedKey", () => {
  it("matches direct pause key", () => {
    expect(isPausedKey({ pauseKey: "ingestion/projection", pausedKeys: ["ingestion/projection"] }))
      .toBe(true);
  });

  it("matches when ancestor is paused", () => {
    expect(isPausedKey({ pauseKey: "ingestion/projection/trace", pausedKeys: ["ingestion"] }))
      .toBe(true);
  });

  it("does not match unrelated keys", () => {
    expect(isPausedKey({ pauseKey: "ingestion/projection", pausedKeys: ["evaluation"] }))
      .toBe(false);
  });

  it("does not match partial prefix without separator", () => {
    expect(isPausedKey({ pauseKey: "ingestion-v2", pausedKeys: ["ingestion"] }))
      .toBe(false);
  });
});

describe("isInheritedPause", () => {
  it("returns true when paused by ancestor only", () => {
    expect(isInheritedPause({ pauseKey: "ingestion/projection", pausedKeys: ["ingestion"] }))
      .toBe(true);
  });

  it("returns false when directly paused", () => {
    expect(isInheritedPause({ pauseKey: "ingestion", pausedKeys: ["ingestion"] }))
      .toBe(false);
  });

  it("returns false when not paused at all", () => {
    expect(isInheritedPause({ pauseKey: "ingestion", pausedKeys: ["evaluation"] }))
      .toBe(false);
  });
});

describe("collectLeafNames", () => {
  it("returns name for leaf node", () => {
    expect(collectLeafNames(makeNode({ name: "trace" }))).toEqual(["trace"]);
  });

  it("returns all leaf names for tree with children", () => {
    const tree = makeNode({
      name: "ingestion",
      children: [
        makeNode({
          name: "projection",
          children: [
            makeNode({ name: "trace" }),
            makeNode({ name: "span" }),
          ],
        }),
      ],
    });

    expect(collectLeafNames(tree)).toEqual(["trace", "span"]);
  });
});
