// @vitest-environment jsdom

/**
 * The page shell every index and detail page is built from. What matters here
 * is the shape it imposes: one h1 per page at the standard size, a header that
 * can drop its rule, and a content card that always wraps its children in a
 * card body.
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageLayout } from "../src/components/page-layout";
import { renderWithDesignSystem } from "../src/testing";

afterEach(() => cleanup());

describe("PageLayout", () => {
  describe("given a page heading", () => {
    it("renders it as the page's single top-level heading", () => {
      renderWithDesignSystem(<PageLayout.Heading>Datasets</PageLayout.Heading>);

      expect(screen.getByRole("heading", { level: 1, name: "Datasets" })).toBeTruthy();
    });
  });

  describe("given a header", () => {
    it("rules off the page below itself by default", () => {
      renderWithDesignSystem(
        <PageLayout.Header data-testid="header">Datasets</PageLayout.Header>,
      );

      expect(getComputedStyle(screen.getByTestId("header")).borderBottomStyle).toBe(
        "solid",
      );
    });

    it("drops the rule when the page draws its own", () => {
      renderWithDesignSystem(
        <PageLayout.Header data-testid="header" withBorder={false}>
          Datasets
        </PageLayout.Header>,
      );

      expect(getComputedStyle(screen.getByTestId("header")).borderBottomStyle).toBe(
        "none",
      );
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
      expect(screen.getByTestId("same").className).toBe(
        screen.getByTestId("default").className,
      );
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
