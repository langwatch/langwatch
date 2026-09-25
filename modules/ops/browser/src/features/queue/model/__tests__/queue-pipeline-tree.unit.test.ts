import { describe, expect, it } from "vitest";

import { hasPipelineWork, pipelinePaths, togglePath } from "../queue-pipeline-utils.ts";
import type { OpsPipelineNode } from "../queue-presentation.ts";

const node = (
  name: string,
  counts: Partial<Pick<OpsPipelineNode, "pending" | "active" | "blocked">> = {},
  children: OpsPipelineNode[] = [],
): OpsPipelineNode => ({
  name,
  pending: 0,
  active: 0,
  blocked: 0,
  children,
  ...counts,
});

describe("hasPipelineWork", () => {
  it.each([
    [node("idle"), false],
    [node("p", { pending: 1 }), true],
    [node("a", { active: 1 }), true],
    [node("b", { blocked: 1 }), true],
    [
      node("parent", {}, [node("idle-child"), node("busy", {}, [node("deep", { blocked: 2 })])]),
      true,
    ],
    [node("parent", {}, [node("idle-child")]), false],
  ])("answers %j -> %s", (subject, expected) => {
    expect(hasPipelineWork(subject)).toBe(expected);
  });
});

describe("pipelinePaths", () => {
  it("lists every path depth-first, parents before children", () => {
    const tree = [node("a", {}, [node("b", {}, [node("c")]), node("d")]), node("e")];
    expect([...pipelinePaths(tree)]).toEqual(["a", "a/b", "a/b/c", "a/d", "e"]);
  });

  it("answers an empty set for an empty tree", () => {
    expect(pipelinePaths([]).size).toBe(0);
  });
});

describe("togglePath", () => {
  it("adds an absent path and removes a present one without touching the input", () => {
    const paths = new Set(["a"]);
    expect([...togglePath(paths, "b")]).toEqual(["a", "b"]);
    expect([...togglePath(paths, "a")]).toEqual([]);
    expect([...paths]).toEqual(["a"]);
  });
});
