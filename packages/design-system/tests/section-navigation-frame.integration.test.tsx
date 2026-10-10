// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SectionNavigationFrame,
  SectionNavigationRail,
} from "../src/components/layout/section-navigation-frame.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

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

    it("drops the visible heading when hideTitle is set, keeping the accessible name", () => {
      renderWithDesignSystem(
        <SectionNavigationFrame
          label="Section"
          hideTitle
          links={LINKS}
          activeHref="/section"
          onNavigate={() => {}}
        >
          <p>Page body</p>
        </SectionNavigationFrame>,
      );

      expect(screen.queryByTestId("section-navigation-title")).toBeNull();
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
    it("names each entry by its label and drops the title, labels, extras and controls", () => {
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
      expect(rail.textContent).not.toContain("Suites");
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
