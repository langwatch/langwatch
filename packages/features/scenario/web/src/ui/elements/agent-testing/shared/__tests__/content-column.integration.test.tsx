/**
 * @vitest-environment jsdom
 *
 * The content column: one readable width, centred on the whole page.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTENT_COLUMN_CENTERING_WIDTH,
  CONTENT_COLUMN_MAX_WIDTH,
  CONTENT_COLUMN_WIDE_MAX_WIDTH,
  ContentColumn,
} from "../content-column";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("the content column", () => {
  afterEach(cleanup);

  /** @scenario The content is held to a column and centred on the page */
  it("holds the content to one readable centred column beside any rail", () => {
    render(
      <ContentColumn railWidth={260}>
        <div>the content</div>
      </ContentColumn>,
      { wrapper: Wrapper },
    );

    const column = screen.getByText("the content").parentElement!;
    expect(column).toHaveStyle({
      maxWidth: CONTENT_COLUMN_MAX_WIDTH,
      marginInline: "auto",
    });

    // On a wide window the rail is paid back on the right, so the column
    // centres on the whole page and sits still when the tab (and its rail
    // width) changes.
    const scroller = column.parentElement!;
    const wideRule = Array.from(document.querySelectorAll("style"))
      .map((style) => style.textContent ?? "")
      .join("\n");
    expect(scroller.className).not.toBe("");
    expect(wideRule).toContain(`@media (min-width: ${CONTENT_COLUMN_CENTERING_WIDTH}px)`);
    expect(wideRule).toContain("padding-right:260px");
  });

  /** @scenario "A surface with no rail takes the width the rail would have used" */
  it("takes the wider column and pays nothing back when it has no rail", () => {
    render(
      <ContentColumn columnMaxWidth={CONTENT_COLUMN_WIDE_MAX_WIDTH}>
        <div>the content</div>
      </ContentColumn>,
      { wrapper: Wrapper },
    );

    const column = screen.getByText("the content").parentElement!;
    expect(column).toHaveStyle({
      maxWidth: CONTENT_COLUMN_WIDE_MAX_WIDTH,
      marginInline: "auto",
    });
    expect(Number.parseInt(CONTENT_COLUMN_WIDE_MAX_WIDTH, 10)).toBeGreaterThan(
      Number.parseInt(CONTENT_COLUMN_MAX_WIDTH, 10),
    );

    const rules = Array.from(document.querySelectorAll("style"))
      .map((style) => style.textContent ?? "")
      .join("\n");
    expect(rules).not.toContain("padding-right:218px");
  });
});
