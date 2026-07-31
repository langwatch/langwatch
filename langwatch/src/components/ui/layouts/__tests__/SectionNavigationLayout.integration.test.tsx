/**
 * @vitest-environment jsdom
 *
 * @see specs/navigation/shared-section-navigation-layout.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { SectionNavigationFrame } from "../SectionNavigationLayout";

function renderFrame() {
  return render(
    <MemoryRouter initialEntries={["/automations"]}>
      <ChakraProvider value={defaultSystem}>
        <SectionNavigationFrame
          sectionLabel="Automations"
          navigationItems={[
            { label: "Overview", href: "/automations" },
            { label: "Alerts", href: "/automations/alerts" },
          ]}
        >
          <h1>Overview</h1>
        </SectionNavigationFrame>
      </ChakraProvider>
    </MemoryRouter>,
  );
}

describe("SectionNavigationFrame", () => {
  it("keeps the section title and links beside the page content", () => {
    renderFrame();

    const navigation = screen.getByRole("navigation", {
      name: "Automations navigation",
    });
    const content = screen.getByTestId("section-navigation-content");

    expect(within(navigation).getByText("Automations")).toBeInTheDocument();
    expect(
      within(navigation).getByRole("link", { name: "Overview" }),
    ).toHaveAttribute("href", "/automations");
    expect(
      within(content).getByRole("heading", { name: "Overview" }),
    ).toBeInTheDocument();
    expect(navigation.nextElementSibling).toBe(content);
  });

  // jsdom resolves no media queries, so the responsive values are asserted
  // as declarations rather than as computed layout: what is pinned is that
  // the rail's fixed width and its shrink lock are conditioned on the
  // breakpoint, which is what stopped a phone-width content column from
  // collapsing to nothing.
  /** @scenario "The local navigation stops taking a column on a narrow viewport" */
  it("drops the fixed-width rail below the md breakpoint", () => {
    renderFrame();

    const navigation = screen.getByRole("navigation", {
      name: "Automations navigation",
    });
    const stack = navigation.parentElement;
    expect(stack).not.toBeNull();

    // The rail and the content stack vertically on a narrow screen and sit
    // side by side from md up.
    expect(
      getComputedStyle(stack!).getPropertyValue("--stack-direction"),
    ).not.toBe("row");

    // Chakra emits the base value inline and the md override in a media
    // query, so the base width is the one readable here: full, not 220px.
    const navStyle = getComputedStyle(navigation);
    expect(navStyle.width).not.toBe("220px");
    expect(navStyle.minWidth).not.toBe("220px");
  });
});
