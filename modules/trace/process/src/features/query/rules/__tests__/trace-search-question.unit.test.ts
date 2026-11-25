/**
 * Spec: specs/traces-v2/search.feature
 */
import { describe, expect, it } from "vitest";

import { isSearchQuestion } from "../trace-search-question.rules.ts";

describe("isSearchQuestion", () => {
  /** @scenario "A sentence reads as a question when it asks one" */
  it("reads a question mark or a question opener as a question, and nothing else", () => {
    expect(isSearchQuestion("Was the customer frustrated?")).toBe(true);
    expect(isSearchQuestion("did the agent call the refund tool")).toBe(true);
    expect(isSearchQuestion("cannot connect to database")).toBe(false);
    expect(isSearchQuestion("how")).toBe(false);
    expect(isSearchQuestion("is")).toBe(false);
    expect(isSearchQuestion("?")).toBe(false);
  });
});
