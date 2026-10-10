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
