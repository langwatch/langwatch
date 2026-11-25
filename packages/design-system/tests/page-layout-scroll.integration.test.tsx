// @vitest-environment jsdom
import { Box } from "@chakra-ui/react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PageHeaderSizeProvider, PageLayout } from "../src/components/layout/page-layout.tsx";
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
  /** @scenario The bottom rule is drawn whether or not the page has scrolled */
  it("draws the rule at the top and while scrolled, reporting the scroll", () => {
    fixture();
    const header = screen.getByTestId("header");
    const initialWidth = getComputedStyle(header).borderBottomWidth;
    expect(header.getAttribute("data-scrolled")).toBe("false");
    expect(initialWidth).toBe("1px");
    expect(getComputedStyle(header).borderBottomColor).toBe("var(--chakra-colors-border)");
    scrollPage(40);
    expect(header.getAttribute("data-scrolled")).toBe("true");
    expect(getComputedStyle(header).borderBottomWidth).toBe(initialWidth);
    expect(getComputedStyle(header).borderBottomColor).toBe("var(--chakra-colors-border)");
    expect(getComputedStyle(header).background).toBe("var(--chakra-colors-bg-surface)");
    expect(getComputedStyle(header).backdropFilter).not.toContain("blur");
    scrollPage(0);
    expect(header.getAttribute("data-scrolled")).toBe("false");
  });

  /** @scenario Restored scroll positions mark the header scrolled immediately */
  it("reads an already scrolled container on mount", () => {
    fixture({ restored: 80 });
    expect(screen.getByTestId("header").getAttribute("data-scrolled")).toBe("true");
  });

  /** @scenario Scrolling another pane does not mark the page title scrolled */
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

describe("header geometry", () => {
  const headerWith = ({ actions = 0, requested }: { actions?: number; requested?: "lg" | "sm" }) =>
    renderWithDesignSystem(
      <PageHeaderSizeProvider size="lg">
        <PageLayout.Header
          size={requested}
          data-testid="header"
          actions={Array.from({ length: actions }, (_, index) => (
            <button key={index} type="button" className="chakra-button">
              Action {index}
            </button>
          ))}
        >
          <PageLayout.Heading>Annotations</PageLayout.Heading>
        </PageLayout.Header>
      </PageHeaderSizeProvider>,
    );

  /** @scenario The area pins header geometry independently of actions */
  it("keeps the large header whatever the actions or the requested size", () => {
    for (const actions of [0, 1, 3]) {
      headerWith({ actions, requested: "sm" });
      const header = screen.getByTestId("header");
      expect(header.getAttribute("data-header-size")).toBe("lg");
      expect(getComputedStyle(header).minHeight).toBe("var(--chakra-sizes-page-header-lg)");
      cleanup();
    }
  });

  /** @scenario Full-screen tools may use compact headers */
  it("gives a standalone header the compact size when it asks for it", () => {
    renderWithDesignSystem(
      <PageLayout.Header size="sm" data-testid="header">
        <PageLayout.Heading>Studio</PageLayout.Heading>
      </PageLayout.Header>,
    );
    const header = screen.getByTestId("header");
    expect(header.getAttribute("data-header-size")).toBe("sm");
    expect(getComputedStyle(header).minHeight).toBe("var(--chakra-sizes-page-header-sm)");
  });
});
