/**
 * @vitest-environment jsdom
 *
 * @see specs/navigation/shell-visual-language.feature
 */
import { ChakraProvider, defaultSystem, Text } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ConsoleRail } from "../ConsoleRail";

const renderRail = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <ConsoleRail
        width="200px"
        isCollapsed={false}
        canToggle={true}
        onToggleCollapsed={() => {}}
      >
        <Text>Nav content</Text>
      </ConsoleRail>
    </ChakraProvider>,
  );

describe("<ConsoleRail />", () => {
  afterEach(() => {
    cleanup();
  });

  /** @scenario The rail keeps its ink in both themes */
  it("scopes the whole column to dark-theme token resolution", () => {
    renderRail();

    // The dark scope is the mechanism behind the theme-invariant rail:
    // everything inside resolves its dark-theme form even while the app is
    // in light mode. This pins the wiring, not any color value.
    const rail = screen.getByTestId("console-rail");
    expect(rail).toHaveClass("dark");
    expect(rail).toHaveAttribute("data-theme", "dark");
  });

  /** @scenario The header row belongs to the workspace */
  it("renders the collapse control and the nav inside the scoped column", () => {
    renderRail();

    const rail = screen.getByTestId("console-rail");
    expect(rail).toContainElement(
      screen.getByRole("button", { name: "Collapse sidebar" }),
    );
    expect(rail).toContainElement(screen.getByText("Nav content"));
  });
});
