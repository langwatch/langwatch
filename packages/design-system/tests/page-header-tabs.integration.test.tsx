// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PageLayout } from "../src/components/layout/page-layout.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

describe("page header tabs", () => {
  /** @scenario The selected tab is underlined on the header's own border */
  it("runs each tab the full header height and marks only the selected one", () => {
    renderWithDesignSystem(
      <PageLayout.Tabs
        label="Pages"
        tabs={[
          { label: "First", href: "/first" },
          { label: "Second", href: "/second" },
        ]}
        activeHref="/second"
        onNavigate={vi.fn()}
      />,
    );

    const first = screen.getByRole("link", { name: "First" });
    const second = screen.getByRole("link", { name: "Second" });
    expect(getComputedStyle(first).height).toBe("var(--chakra-sizes-full)");
    expect(getComputedStyle(second).height).toBe("var(--chakra-sizes-full)");
    expect(second.getAttribute("data-active")).toBe("true");
    expect(first.hasAttribute("data-active")).toBe(false);
  });
});

describe("page header tabs stacking", () => {
  /** @scenario Header tabs can stack under the heading on phones */
  it("keeps the inline margin unless a caller opts in, and still marks the current tab", () => {
    renderWithDesignSystem(
      <>
        <PageLayout.Tabs
          label="Plain"
          tabs={[{ label: "One", href: "/one" }]}
          activeHref="/one"
          onNavigate={vi.fn()}
        />
        <PageLayout.Tabs
          stackOnMobile
          label="Stacked"
          tabs={[{ label: "Two", href: "/two" }]}
          activeHref="/two"
          onNavigate={vi.fn()}
        />
      </>,
    );

    expect(screen.getByRole("navigation", { name: "Plain" }).getAttribute("class")).not.toBe(
      screen.getByRole("navigation", { name: "Stacked" }).getAttribute("class"),
    );
    expect(screen.getByRole("link", { name: "Two" }).getAttribute("aria-current")).toBe("page");
  });
});
