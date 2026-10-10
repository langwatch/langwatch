// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SectionNavigationFrame,
  SectionNavigationItem,
  SectionNavigationRail,
} from "../src/components/layout/section-navigation-frame.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const LINKS = [
  { label: "Overview", href: "/section" },
  { label: "Details", href: "/section/details" },
];

describe("SectionNavigationFrame", () => {
  describe("given the links it is handed and the page it frames", () => {
    it("renders each link to its address beside the content", () => {
      renderWithDesignSystem(
        <SectionNavigationFrame
          label="Section"
          links={LINKS}
          activeHref="/section"
          onNavigate={() => {}}
        >
          <p>Page body</p>
        </SectionNavigationFrame>,
      );

      const rail = screen.getByRole("navigation", { name: "Section navigation" });
      expect(rail.textContent).toContain("Section");
      expect(screen.getByRole("link", { name: "Details" }).getAttribute("href")).toBe(
        "/section/details",
      );
      expect(screen.getByText("Page body")).toBeTruthy();
    });

    it("shows the section title beside the current sub-page heading", () => {
      renderWithDesignSystem(
        <SectionNavigationFrame
          label="Section"
          pageTitle="Details"
          links={LINKS}
          activeHref="/section"
          onNavigate={() => {}}
        >
          <p>Page body</p>
        </SectionNavigationFrame>,
      );

      expect(screen.getByTestId("section-navigation-title").textContent).toBe("Section");
      expect(screen.getByRole("heading", { name: "Details" })).toBeTruthy();
      expect(screen.getByRole("navigation", { name: "Section navigation" })).toBeTruthy();
    });

    it("marks only the active entry as the current page", () => {
      renderWithDesignSystem(
        <SectionNavigationFrame
          label="Section"
          links={LINKS}
          activeHref="/section/details"
          onNavigate={() => {}}
        >
          <p>Page body</p>
        </SectionNavigationFrame>,
      );

      expect(screen.getByRole("link", { name: "Details" }).getAttribute("aria-current")).toBe(
        "page",
      );
      expect(screen.getByRole("link", { name: "Overview" }).hasAttribute("aria-current")).toBe(
        false,
      );
    });
  });

  describe("when the reader clicks an entry", () => {
    /** @scenario "A section rail routes its entries in place" */
    it("routes a plain click through onNavigate and leaves a modified click to the browser", () => {
      const onNavigate = vi.fn<(href: string) => void>();
      renderWithDesignSystem(
        <SectionNavigationFrame
          label="Section"
          links={LINKS}
          activeHref="/section"
          onNavigate={onNavigate}
        >
          <p>Page body</p>
        </SectionNavigationFrame>,
      );

      const details = screen.getByRole("link", { name: "Details" });
      const followed = fireEvent.click(details);
      fireEvent.click(details, { metaKey: true });

      expect(followed).toBe(false);
      expect(onNavigate).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith("/section/details");
    });
  });

  describe("given labelled groups and a trailing slot", () => {
    it("renders each group under its label with the slot beneath its entries", () => {
      renderWithDesignSystem(
        <SectionNavigationFrame
          label="Section"
          links={LINKS.slice(0, 1)}
          groups={[
            { label: "Engagement", links: [{ label: "Users", href: "/section/users" }] },
            { label: "Custom", links: [], extra: <p>Saved dashboards</p> },
          ]}
          activeHref="/section/users"
          onNavigate={() => {}}
        >
          <p>Page body</p>
        </SectionNavigationFrame>,
      );

      const rail = screen.getByRole("navigation", { name: "Section navigation" });
      expect(rail.textContent).toContain("Engagement");
      expect(rail.textContent).toContain("Saved dashboards");
      expect(screen.getByRole("link", { name: "Users" }).getAttribute("aria-current")).toBe("page");
    });
  });

  describe("given entries with their own controls and counts", () => {
    /** @scenario "An entry's own controls sit beside its link, not inside it" */
    it("puts the row menu beside the link and still routes the link", () => {
      const onNavigate = vi.fn<(href: string) => void>();
      renderWithDesignSystem(
        <SectionNavigationRail
          label="Suites"
          links={[
            {
              label: "Refunds",
              href: "/suites/refunds",
              testId: "rail-refunds",
              actions: <button type="button">Actions for Refunds</button>,
            },
          ]}
          activeHref=""
          onNavigate={onNavigate}
        />,
      );

      const link = screen.getByTestId("rail-refunds");
      const menu = screen.getByRole("button", { name: "Actions for Refunds" });
      expect(link.tagName).toBe("A");
      expect(link.contains(menu)).toBe(false);
      fireEvent.click(link);
      expect(onNavigate).toHaveBeenCalledWith("/suites/refunds");
    });

    /** @scenario "An entry carries a trailing count" */
    it("ends the entry with its count", () => {
      renderWithDesignSystem(
        <SectionNavigationRail
          label="Annotations"
          links={[{ label: "Inbox", href: "/inbox", badge: 4 }]}
          activeHref="/inbox"
          onNavigate={() => {}}
        />,
      );

      expect(screen.getByRole("link", { name: "Inbox 4" })).toBeTruthy();
    });
  });

  describe("given a folded rail with a footer", () => {
    /** @scenario "A folded rail keeps its entries reachable by name" */
    it("names each entry and retains the section title while folding its controls", () => {
      renderWithDesignSystem(
        <SectionNavigationRail
          label="Suites"
          collapsed
          groups={[
            {
              label: "From code",
              links: [
                {
                  label: "nightly",
                  href: "/external/nightly",
                  actions: <button type="button">Actions for nightly</button>,
                },
              ],
              extra: <p>New suite</p>,
            },
          ]}
          activeHref="/external/nightly"
          onNavigate={() => {}}
        />,
      );

      expect(screen.getByRole("link", { name: "nightly" })).toBeTruthy();
      const rail = screen.getByRole("navigation", { name: "Suites navigation" });
      expect(screen.getByTestId("section-navigation-title").textContent).toBe("Suites");
      expect(rail.textContent).not.toContain("From code");
      expect(rail.textContent).not.toContain("New suite");
      expect(screen.queryByRole("button", { name: "Actions for nightly" })).toBeNull();
    });

    /** @scenario "The rail pins its footer under the entries" */
    it("renders the footer inside the rail after the entries", () => {
      renderWithDesignSystem(
        <SectionNavigationRail
          label="Suites"
          links={LINKS}
          activeHref="/section"
          onNavigate={() => {}}
          footer={<button type="button">Fold the rail</button>}
        />,
      );

      const rail = screen.getByRole("navigation", { name: "Suites navigation" });
      const toggle = screen.getByRole("button", { name: "Fold the rail" });
      const last = screen.getByRole("link", { name: "Details" });
      expect(rail.contains(toggle)).toBe(true);
      expect(last.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  describe("given a run that may gain one more entry", () => {
    /** @scenario "The add row lines up with the entries and wears their shape" */
    it("ends the run with an add row that asks the page to create one", () => {
      const onClick = vi.fn();
      const { rerender } = renderWithDesignSystem(
        <SectionNavigationRail
          label="Suites"
          groups={[{ links: LINKS, add: { label: "New suite", onClick, testId: "rail-add" } }]}
          activeHref="/section"
          onNavigate={() => {}}
        />,
      );

      const add = screen.getByRole("button", { name: "New suite" });
      const last = screen.getByRole("link", { name: "Details" });
      expect(last.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      fireEvent.click(add);
      expect(onClick).toHaveBeenCalledTimes(1);

      rerender(
        <SectionNavigationRail
          label="Suites"
          collapsed
          groups={[{ links: LINKS, add: { label: "New suite", onClick } }]}
          activeHref="/section"
          onNavigate={() => {}}
        />,
      );
      expect(screen.queryByRole("button", { name: "New suite" })).toBeNull();
    });
  });
});

describe("Section navigation selection marker", () => {
  let paintedMarkerPositions: string[];
  beforeEach(() => {
    paintedMarkerPositions = [];
    const computedStyle = globalThis.getComputedStyle;
    vi.spyOn(globalThis, "getComputedStyle").mockImplementation((element) => {
      const style = computedStyle(element);
      if (element.getAttribute("data-testid") === "section-navigation-list") {
        Object.defineProperty(style, "paddingLeft", { value: "12px" });
      }
      return style;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.dataset.testid === "section-navigation-indicator") {
        paintedMarkerPositions.push(this.style.transform);
      }
      if (this.dataset.testid === "section-navigation-list") return new DOMRect(100, 100, 176, 300);
      if (this.getAttribute("href") === "/section") return new DOMRect(112, 108, 152, 32);
      if (this.getAttribute("href") === "/section/details") return new DOMRect(112, 178, 152, 40);
      return new DOMRect();
    });
  });

  const rail = (activeHref: string) => (
    <SectionNavigationRail
      label="Section"
      links={LINKS}
      activeHref={activeHref}
      onNavigate={() => {}}
    />
  );

  describe("when the controlled selection changes", () => {
    /** @scenario "One marker follows the active entry" */
    it("moves the same marker to the new link and hides it without a selection", async () => {
      const { rerender } = renderWithDesignSystem(rail("/section"));
      const marker = screen.getByTestId("section-navigation-indicator");
      expect(marker.style.transform).toBe("translate3d(0px, 16px, 0)");
      expect(marker.style.height).toBe("16px");
      expect(marker.style.visibility).toBe("visible");
      expect(marker.style.transition).toBe("transform 180ms ease-out, height 180ms ease-out");

      rerender(rail("/section/details"));
      await waitFor(() => expect(marker.style.transform).toBe("translate3d(0px, 86px, 0)"));
      expect(marker.style.height).toBe("24px");
      expect(screen.getAllByTestId("section-navigation-indicator")).toEqual([marker]);
      expect(screen.getByRole("link", { name: "Details" }).getAttribute("aria-current")).toBe(
        "page",
      );

      rerender(rail(""));
      await waitFor(() => expect(marker.style.visibility).toBe("hidden"));
    });
  });

  describe("when a route replaces its rail", () => {
    /** @scenario "A replacement rail continues the selection movement" */
    it("establishes the previous position before moving the replacement marker", async () => {
      const page = (href: string) => (
        <SectionNavigationRail
          key={href}
          label="Section"
          links={LINKS}
          activeHref={href}
          onNavigate={() => {}}
        />
      );
      const { rerender } = renderWithDesignSystem(page("/section"));
      paintedMarkerPositions = [];
      fireEvent.click(screen.getByRole("link", { name: "Details" }));

      rerender(page("/section/details"));

      expect(paintedMarkerPositions).toEqual(["translate3d(0px, 16px, 0)"]);
      const marker = screen.getByTestId("section-navigation-indicator");
      await waitFor(() => expect(marker.style.transform).toBe("translate3d(0px, 86px, 0)"));
      expect(marker.style.transition).toBe("transform 180ms ease-out, height 180ms ease-out");
      expect(screen.getAllByTestId("section-navigation-indicator")).toHaveLength(1);
    });
  });

  describe("given a reader who prefers reduced motion", () => {
    /** @scenario "Reduced motion moves the marker without animation" */
    it("updates position with no transition", async () => {
      renderWithDesignSystem(<span />);
      const originalMatchMedia = window.matchMedia;
      vi.spyOn(window, "matchMedia").mockImplementation((query) => {
        const media = originalMatchMedia(query);
        Object.defineProperty(media, "matches", {
          configurable: true,
          value: query === "(prefers-reduced-motion: reduce)",
        });
        return media;
      });
      const { rerender } = renderWithDesignSystem(rail("/section"));
      const marker = screen.getByTestId("section-navigation-indicator");
      expect(marker.style.transition).toBe("none");

      rerender(rail("/section/details"));
      await waitFor(() => expect(marker.style.transform).toBe("translate3d(0px, 86px, 0)"));
      expect(marker.style.height).toBe("24px");
      expect(marker.style.transition).toBe("none");
    });
  });

  describe("given a nested dashboard list in the extra slot", () => {
    /** @scenario "The marker follows entries supplied by a nested list" */
    it("tracks the nested current link even when the rail activeHref stays empty", async () => {
      const nestedRail = (activeHref: string) => (
        <SectionNavigationRail
          label="Analytics"
          activeHref=""
          onNavigate={() => {}}
          groups={[
            {
              links: [],
              extra: LINKS.map((link) => (
                <SectionNavigationItem
                  key={link.href}
                  link={link}
                  activeHref={activeHref}
                  onNavigate={() => {}}
                />
              )),
            },
          ]}
        />
      );
      const { rerender } = renderWithDesignSystem(nestedRail("/section"));
      const marker = screen.getByTestId("section-navigation-indicator");
      expect(marker.style.transform).toBe("translate3d(0px, 16px, 0)");

      rerender(nestedRail("/section/details"));
      await waitFor(() => expect(marker.style.transform).toBe("translate3d(0px, 86px, 0)"));
      expect(screen.getAllByTestId("section-navigation-indicator")).toEqual([marker]);
    });
  });
});
