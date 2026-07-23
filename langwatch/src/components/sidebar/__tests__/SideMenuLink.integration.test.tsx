/**
 * @vitest-environment jsdom
 *
 * @see specs/navigation/shell-visual-language.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { Activity } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";

import { SideMenuItem } from "../SideMenuLink";

const renderItem = (
  props: Partial<React.ComponentProps<typeof SideMenuItem>> = {},
) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <SideMenuItem icon={Activity} label="Traces" {...props} />
    </ChakraProvider>,
  );

describe("<SideMenuItem />", () => {
  afterEach(() => {
    cleanup();
  });

  /** @scenario The active destination carries an indicator light */
  it("shows the indicator light only on the active row", () => {
    renderItem({ isActive: true });
    expect(screen.getByTestId("nav-active-indicator")).toBeInTheDocument();

    cleanup();

    renderItem({ isActive: false });
    expect(
      screen.queryByTestId("nav-active-indicator"),
    ).not.toBeInTheDocument();
  });

  /** @scenario The active destination carries an indicator light */
  it("keeps the indicator light on the compact, icon-only rail", () => {
    renderItem({ isActive: true, showLabel: false });

    // The light lives outside the label branch by design — the compact rail
    // has no label or background to carry the active signal.
    expect(screen.getByTestId("nav-active-indicator")).toBeInTheDocument();
    expect(screen.queryByText("Traces")).not.toBeInTheDocument();
  });
});
