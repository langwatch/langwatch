/**
 * The one place the personal workspace's addresses are spelled.
 * Spec: specs/navigation/coding-agents-url-move.feature
 */
import { describe, expect, it } from "vitest";

import { codingAgentsPath } from "../coding-agents-paths.ts";

describe("given an address in the personal workspace", () => {
  describe("when no page is named", () => {
    it("is the home", () => {
      expect(codingAgentsPath()).toBe("/coding-agents");
    });
  });

  describe("when a page is named", () => {
    it("sits under the home", () => {
      expect(codingAgentsPath({ page: "configure" })).toBe("/coding-agents/configure");
      expect(codingAgentsPath({ page: "budget/request" })).toBe("/coding-agents/budget/request");
    });
  });

  describe("when a query is given", () => {
    it("carries it, encoded", () => {
      expect(codingAgentsPath({ page: "configure", query: { tab: "devices" } })).toBe(
        "/coding-agents/configure?tab=devices",
      );
      expect(
        codingAgentsPath({ page: "budget/request", query: new URLSearchParams({ x: "a b" }) }),
      ).toBe("/coding-agents/budget/request?x=a+b");
    });

    it("adds no question mark when the query is empty", () => {
      expect(codingAgentsPath({ query: {} })).toBe("/coding-agents");
    });
  });
});
