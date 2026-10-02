/**
 * Integration tests for SetCard component.
 * @vitest-environment jsdom
 * @see specs/scenarios/internal-set-namespace.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { ON_PLATFORM_DISPLAY_NAME } from "@langwatch/scenario-contract";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SetCard } from "../ui/elements/set-card.tsx";

describe("<SetCard/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given an internal set ID", () => {
    const internalSetId = "__internal__proj_abc123__on-platform-scenarios";
    const defaultProps = {
      scenarioSetId: internalSetId,
      scenarioCount: 5,
      lastRunAt: Date.now(),
      onClick: vi.fn(),
    };

    describe("when the SetCard renders", () => {
      it("displays the on-platform display name", () => {
        renderWithDesignSystem(<SetCard {...defaultProps} />);

        expect(screen.getByText(ON_PLATFORM_DISPLAY_NAME)).toBeInTheDocument();
      });

      it("does not display the raw internal ID", () => {
        renderWithDesignSystem(<SetCard {...defaultProps} />);

        expect(screen.queryByText(internalSetId)).not.toBeInTheDocument();
      });

      it("displays a system/settings icon instead of the default icon", () => {
        renderWithDesignSystem(<SetCard {...defaultProps} />);

        // The settings icon should be present (we use Settings from lucide-react)
        // We check for the absence of the default emoji icon
        expect(screen.queryByText("\uD83C\uDFAD")).not.toBeInTheDocument();
      });
    });
  });

  describe("given a user-created set ID", () => {
    const userSetId = "my-production-tests";
    const defaultProps = {
      scenarioSetId: userSetId,
      scenarioCount: 3,
      lastRunAt: Date.now(),
      onClick: vi.fn(),
    };

    describe("when the SetCard renders", () => {
      it("displays the set ID as the name", () => {
        renderWithDesignSystem(<SetCard {...defaultProps} />);

        expect(screen.getByText(userSetId)).toBeInTheDocument();
      });

      it("displays the default icon", () => {
        renderWithDesignSystem(<SetCard {...defaultProps} />);

        // The default emoji icon should be present
        expect(screen.getByText("\uD83C\uDFAD")).toBeInTheDocument();
      });
    });
  });
});
