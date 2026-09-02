/**
 * @vitest-environment jsdom
 *
 * Pins the on-platform (internal) run set's display treatment: it always
 * reads with a friendly name, and v1 keeps the name it shows today while the
 * v2 surface renames it on its own side.
 *
 * @see specs/suites/one-off-runs-surface.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { ON_PLATFORM_DISPLAY_NAME } from "@langwatch/scenario-contract";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetCard } from "../../../index";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("the on-platform run set name", () => {
  afterEach(() => {
    cleanup();
  });

  const internalSetId = "__internal__proj_abc123__on-platform-scenarios";
  const defaultProps = {
    scenarioSetId: internalSetId,
    scenarioCount: 5,
    lastRunAt: Date.now(),
    onClick: vi.fn(),
  };

  /** @scenario "The internal run set reads with a friendly name, never its raw address" */
  it("shows a readable name and never the raw address", () => {
    render(<SetCard {...defaultProps} />, { wrapper: Wrapper });

    expect(screen.getByText(ON_PLATFORM_DISPLAY_NAME)).toBeInTheDocument();
    expect(screen.queryByText(internalSetId)).not.toBeInTheDocument();
  });

  /** @scenario "The v1 pages keep the name they show today" */
  it('keeps the v1 name "Manual Run" on the v1 card', () => {
    render(<SetCard {...defaultProps} />, { wrapper: Wrapper });

    expect(screen.getByText("Manual Run")).toBeInTheDocument();
    expect(screen.queryByText("One-off runs")).not.toBeInTheDocument();
  });
});
