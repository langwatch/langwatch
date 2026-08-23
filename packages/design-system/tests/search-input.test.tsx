// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SearchInput } from "../src/components/search-input";
import { renderWithDesignSystem } from "../src/testing";

describe("SearchInput", () => {
  /** @scenario Shared controls expose accessible names and focus */
  it("provides a stable accessible name and hides its decorative icon", () => {
    const { container } = renderWithDesignSystem(<SearchInput />);
    expect(screen.getByRole("searchbox", { name: "Search" })).toBeTruthy();
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });
});
