// @vitest-environment jsdom
import { Box } from "@chakra-ui/react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PageLayout } from "../src/components/layout/page-layout.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

function fixture({ border = true, restored = 0 } = {}) {
  return renderWithDesignSystem(
    <>
      <Box
        data-testid="page-scroll"
        overflowY="auto"
        height="200px"
        ref={(node: HTMLDivElement | null) => {
          if (node) node.scrollTop = restored;
        }}
      >
        <Box overflowX="auto" position="sticky" top={0}>
          <PageLayout.Header withBorder={border} data-testid="header">
            <PageLayout.Heading>Annotations</PageLayout.Heading>
          </PageLayout.Header>
        </Box>
        <Box height="1000px">Page content</Box>
      </Box>
      <Box data-testid="other-scroll" overflowY="auto" height="200px">
        Other pane
      </Box>
    </>,
  );
}

function scrollPage(top: number) {
  const page = screen.getByTestId("page-scroll");
  page.scrollTop = top;
  fireEvent.scroll(page);
}

describe("sticky page header", () => {
  /** @scenario The hairline appears only after content crosses the title boundary */
  it("reveals the hairline when the page scrolls and clears it at the top without resizing", () => {
    fixture();
    const header = screen.getByTestId("header");
    const initialWidth = getComputedStyle(header).borderBottomWidth;
    expect(header.getAttribute("data-scrolled")).toBe("false");
    expect(initialWidth).toBe("1px");
    expect(getComputedStyle(header).borderBottomColor).toBe("var(--chakra-colors-transparent)");
    scrollPage(40);
    expect(header.getAttribute("data-scrolled")).toBe("true");
    expect(getComputedStyle(header).borderBottomWidth).toBe(initialWidth);
    expect(getComputedStyle(header).borderBottomColor).toBe("var(--chakra-colors-border-card)");
    scrollPage(0);
    expect(header.getAttribute("data-scrolled")).toBe("false");
  });

  /** @scenario Restored scroll positions show the title separator immediately */
  it("reads an already scrolled container on mount", () => {
    fixture({ restored: 80 });
    expect(screen.getByTestId("header").getAttribute("data-scrolled")).toBe("true");
  });

  /** @scenario Scrolling another pane does not decorate the page title */
  it("ignores a sibling drawer or pane", () => {
    fixture();
    const other = screen.getByTestId("other-scroll");
    other.scrollTop = 70;
    fireEvent.scroll(other);
    expect(screen.getByTestId("header").getAttribute("data-scrolled")).toBe("false");
  });

  /** @scenario Explicit borderless headers remain borderless after scrolling */
  it("honors the borderless opt-out", () => {
    fixture({ border: false });
    scrollPage(40);
    expect(screen.getByTestId("header").getAttribute("data-scrolled")).toBe("true");
    expect(getComputedStyle(screen.getByTestId("header")).borderBottomWidth).toBe("0px");
  });
});
