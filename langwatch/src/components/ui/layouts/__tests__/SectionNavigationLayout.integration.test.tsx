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

describe("SectionNavigationFrame", () => {
  it("keeps the section title and links beside the page content", () => {
    render(
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
});
