/**
 * Pins the on-platform run set's friendly name: v1 keeps its current name, v2 renames separately.
 * @vitest-environment jsdom
 * @see specs/suites/internal-run-set-surface.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { ON_PLATFORM_DISPLAY_NAME } from "@langwatch/scenario-contract";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SetCard } from "../../../elements/set-card.tsx";

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
    renderWithDesignSystem(<SetCard {...defaultProps} />);

    expect(screen.getByText(ON_PLATFORM_DISPLAY_NAME)).toBeInTheDocument();
    expect(screen.queryByText(internalSetId)).not.toBeInTheDocument();
  });

  /** @scenario "The v1 pages keep the name they show today" */
  it('keeps the v1 name "Manual Run" on the v1 card', () => {
    renderWithDesignSystem(<SetCard {...defaultProps} />);

    expect(screen.getByText("Manual Run")).toBeInTheDocument();
    expect(screen.queryByText("One-off runs")).not.toBeInTheDocument();
  });
});
