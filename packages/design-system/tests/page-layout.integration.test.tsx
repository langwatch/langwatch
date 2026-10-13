// @vitest-environment jsdom

/** The page shell every index and detail page is built from. What matters here is the shape it
 * imposes: one h1 per page at the standard size, a header that can drop its rule, and a content
 * card that always wraps its children in a card body. */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PageHeaderSizeProvider, PageLayout } from "../src/components/layout/page-layout.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

describe("PageLayout", () => {
  describe("given a page heading", () => {
    it("renders it as the page's single top-level heading", () => {
      renderWithDesignSystem(<PageLayout.Heading>Datasets</PageLayout.Heading>);

      expect(screen.getByRole("heading", { level: 1, name: "Datasets" })).toBeTruthy();
    });
  });

  describe("given a header with a description", () => {
    it("sets it as one muted body line under the title and lets the header grow", () => {
      renderWithDesignSystem(
        <PageLayout.Header
          data-testid="header"
          description="What a role can do."
          actions={<PageLayout.HeaderButton>New role</PageLayout.HeaderButton>}
        >
          <PageLayout.Heading>Roles</PageLayout.Heading>
        </PageLayout.Header>,
      );

      const header = getComputedStyle(screen.getByTestId("header"));
      const line = screen.getByText("What a role can do.");
      expect(header.height).toBe("auto");
      expect(header.maxHeight).toBe("none");
      expect(header.paddingTop).toBe("var(--chakra-spacing-3)");
      expect(header.paddingBottom).toBe("var(--chakra-spacing-3)");
      expect(line.hasAttribute("data-header-description")).toBe(true);
      const stack = line.parentElement;
      if (!stack) throw new Error("description has no stack");
      expect(getComputedStyle(stack).gap).toBe("var(--chakra-spacing-1)");
      expect(getComputedStyle(line).fontSize).toBe("14px");
      expect(getComputedStyle(line).lineHeight).toBe("20px");
      expect(screen.getByRole("button", { name: "New role" })).toBeTruthy();
    });

    it("reserves no description line when there is none", () => {
      renderWithDesignSystem(
        <PageLayout.Header data-testid="header">
          <PageLayout.Heading>Security</PageLayout.Heading>
        </PageLayout.Header>,
      );

      expect(document.querySelector("[data-header-description]")).toBeNull();
      expect(getComputedStyle(screen.getByTestId("header")).minHeight).toBe(
        "var(--chakra-sizes-page-header-lg)",
      );
    });
  });

  describe("given a header", () => {
    it("rules off the page below itself by default", () => {
      renderWithDesignSystem(<PageLayout.Header data-testid="header">Datasets</PageLayout.Header>);

      expect(getComputedStyle(screen.getByTestId("header")).borderBottomStyle).toBe("solid");
    });

    it("drops the rule when the page draws its own", () => {
      renderWithDesignSystem(
        <PageLayout.Header data-testid="header" withBorder={false}>
          Datasets
        </PageLayout.Header>,
      );

      expect(getComputedStyle(screen.getByTestId("header")).borderBottomStyle).toBe("none");
    });
  });

  describe("given a container beside a sidebar", () => {
    it("lays the page out against the width the sidebar leaves it", () => {
      renderWithDesignSystem(
        <>
          <PageLayout.Container data-testid="default">wide</PageLayout.Container>
          <PageLayout.Container data-testid="same" sidebarWidth={200}>
            wide
          </PageLayout.Container>
          <PageLayout.Container data-testid="narrow" sidebarWidth={320}>
            narrow
          </PageLayout.Container>
        </>,
      );

      // The generated class is the layout: two containers sharing a sidebar
      // width must land on the same one, and a different width must not.
      expect(screen.getByTestId("same").className).toBe(screen.getByTestId("default").className);
      expect(screen.getByTestId("narrow").className).not.toBe(
        screen.getByTestId("default").className,
      );
    });
  });

  describe("given page content", () => {
    it("wraps it in a card body rather than dropping it on the page", () => {
      renderWithDesignSystem(
        <PageLayout.Content data-testid="card">
          <span>rows</span>
        </PageLayout.Content>,
      );

      const card = screen.getByTestId("card");
      const body = card.firstElementChild;

      expect(body).not.toBeNull();
      expect(body?.textContent).toBe("rows");
      expect(screen.getByText("rows").parentElement).toBe(body);
    });
  });

  describe("given a header action", () => {
    it("reaches the caller when pressed", () => {
      const onClick = vi.fn<() => void>();
      renderWithDesignSystem(
        <PageLayout.HeaderButton onClick={onClick}>New dataset</PageLayout.HeaderButton>,
      );

      fireEvent.click(screen.getByRole("button", { name: "New dataset" }));

      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });
});

describe("area-owned header geometry", () => {
  it("keeps the large row and title box when pages request compact sizing or add actions", () => {
    renderWithDesignSystem(
      <PageHeaderSizeProvider size="lg">
        {[0, 1, 5].map((count) => (
          <PageLayout.Header
            key={count}
            size="sm"
            data-testid={`row-${count}`}
            actions={Array.from({ length: count }, (_, index) => (
              <PageLayout.HeaderButton key={index}>Action {index}</PageLayout.HeaderButton>
            ))}
          >
            <PageLayout.Heading>Title {count}</PageLayout.Heading>
          </PageLayout.Header>
        ))}
      </PageHeaderSizeProvider>,
    );
    for (const count of [0, 1, 5]) {
      const row = screen.getByTestId(`row-${count}`);
      const style = getComputedStyle(row);
      expect(row.dataset.headerSize).toBe("lg");
      expect(style.minHeight).toBe("var(--chakra-sizes-page-header-lg)");
      expect(style.height).toBe("auto");
      expect(style.paddingInline).toBe("var(--page-inset, var(--chakra-spacing-6))");
      expect(style.paddingTop).toBe("0px");
      expect(style.borderBottomColor).toBe("var(--chakra-colors-border)");
      // jsdom shows the phone layout, which wraps; from `md` up the row stays single-line.
      expect(style.flexWrap).toBe("wrap");
      const title = getComputedStyle(screen.getByRole("heading", { name: `Title ${count}` }));
      expect(title.fontSize).toBe("16px");
      expect(title.fontWeight).toBe("500");
      expect(title.height).toBe("28px");
      expect(title.lineHeight).toBe("28px");
    }
  });

  it("allows compact sizing only outside the shell's large area", () => {
    renderWithDesignSystem(
      <PageHeaderSizeProvider size="sm">
        <PageLayout.Header data-testid="tool">
          <PageLayout.Heading>Tool</PageLayout.Heading>
          <PageLayout.HeaderButton>Run</PageLayout.HeaderButton>
        </PageLayout.Header>
      </PageHeaderSizeProvider>,
    );
    expect(getComputedStyle(screen.getByTestId("tool")).minHeight).toBe(
      "var(--chakra-sizes-page-header-sm)",
    );
    expect(getComputedStyle(screen.getByRole("heading")).fontSize).toBe("16px");
    expect(getComputedStyle(screen.getByRole("button")).height).toBe("28px");
  });
});
