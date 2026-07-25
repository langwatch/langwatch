/**
 * @vitest-environment jsdom
 *
 * @see specs/evaluations/experiments-online-evaluations-separation.feature
 */
import { ChakraProvider, defaultSystem, Text } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { getSidebarSectionStorageKey, SidebarSection } from "../SidebarSection";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderSection = ({
  id = "observe",
  label = "Observe",
  defaultExpanded = true,
}: {
  id?: string;
  label?: string;
  defaultExpanded?: boolean;
} = {}) =>
  render(
    <SidebarSection
      id={id}
      label={label}
      defaultExpanded={defaultExpanded}
      showExpanded
    >
      <Text>Section destination</Text>
    </SidebarSection>,
    { wrapper: Wrapper },
  );

describe("<SidebarSection />", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  /** @scenario Collapse primary navigation sections */
  it("collapses a section and persists its independent preference", async () => {
    const user = userEvent.setup();
    renderSection();

    expect(screen.getByText("Section destination")).toBeInTheDocument();
    const collapseButton = screen.getByRole("button", {
      name: "Collapse Observe",
    });
    expect(collapseButton).toHaveAttribute("aria-expanded", "true");

    await user.click(collapseButton);

    expect(screen.queryByText("Section destination")).not.toBeInTheDocument();
    expect(localStorage.getItem(getSidebarSectionStorageKey("observe"))).toBe(
      "false",
    );
    expect(
      screen.getByRole("button", { name: "Expand Observe" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  /** @scenario Collapse primary navigation sections */
  it("shows a dim caret beside the label only while collapsed", async () => {
    const user = userEvent.setup();
    renderSection();

    const label = screen.getByText("Observe");
    const heading = label.parentElement;

    expect(heading).not.toBeNull();
    expect(heading).toHaveStyle({ justifyContent: "flex-start" });
    // Expanded headings stay decluttered — no caret. Pinned end-to-end by
    // documentation-link-style.spec.ts ("section carets stay dim").
    expect(heading?.querySelector("svg")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Collapse Observe" }));

    const collapsedLabel = screen.getByText("Observe");
    const caretWrapper = collapsedLabel.nextElementSibling;
    expect(caretWrapper?.querySelector("svg")).not.toBeNull();
    expect(caretWrapper).toHaveStyle({ opacity: "0.5" });
  });

  /** @scenario Collapse primary navigation sections */
  it("restores a saved preference after remount", () => {
    localStorage.setItem(getSidebarSectionStorageKey("observe"), "false");

    renderSection();

    expect(screen.queryByText("Section destination")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand Observe" }),
    ).toBeInTheDocument();
  });

  /** @scenario Use sensible section defaults without a saved preference */
  it("supports Build being collapsed by default", () => {
    renderSection({
      id: "library",
      label: "Build",
      defaultExpanded: false,
    });

    expect(screen.queryByText("Section destination")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand Build" }),
    ).toBeInTheDocument();
  });

  /** @scenario Use sensible section defaults without a saved preference */
  it("lets a saved preference override the default", () => {
    localStorage.setItem(getSidebarSectionStorageKey("library"), "true");

    renderSection({
      id: "library",
      label: "Build",
      defaultExpanded: false,
    });

    expect(screen.getByText("Section destination")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Collapse Build" }),
    ).toBeInTheDocument();
  });
});
