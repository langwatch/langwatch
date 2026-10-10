/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";
import { InlineCode } from "../inline-code.tsx";

afterEach(cleanup);

describe("Feature: Machine identifiers read as code", () => {
  /** @scenario "An identifier renders as a code element with its full text as title" */
  it("Scenario: An identifier renders as a code element with its full text as title", () => {
    renderWithDesignSystem(<InlineCode>gateway.virtual_key.created</InlineCode>);
    const el = screen.getByText("gateway.virtual_key.created");
    expect(el.tagName).toBe("CODE");
    expect(el).toHaveAttribute("title", "gateway.virtual_key.created");
  });

  /** @scenario "A glob wildcard is emphasised" */
  it("Scenario: A glob wildcard is emphasised", () => {
    renderWithDesignSystem(<InlineCode>gateway.*</InlineCode>);
    expect(screen.getByText("*").tagName).toBe("SPAN");
    expect(screen.getByTitle("gateway.*").textContent).toBe("gateway.*");
  });
});
