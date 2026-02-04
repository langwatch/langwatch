/**
 * @vitest-environment jsdom
 *
 * Integration tests for SetCard component.
 *
 * Tests the UI treatment for internal vs user-created sets.
 *
 * @see specs/scenarios/internal-set-namespace.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetCard } from "../SetCard";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

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
      it('displays "On-Platform Scenarios" as the name', () => {
        render(<SetCard {...defaultProps} />, { wrapper: Wrapper });

        expect(screen.getByText("On-Platform Scenarios")).toBeInTheDocument();
      });

      it("does not display the raw internal ID", () => {
        render(<SetCard {...defaultProps} />, { wrapper: Wrapper });

        expect(screen.queryByText(internalSetId)).not.toBeInTheDocument();
      });

      it("displays a system/settings icon instead of the default icon", () => {
        render(<SetCard {...defaultProps} />, { wrapper: Wrapper });

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
        render(<SetCard {...defaultProps} />, { wrapper: Wrapper });

        expect(screen.getByText(userSetId)).toBeInTheDocument();
      });

      it("displays the default icon", () => {
        render(<SetCard {...defaultProps} />, { wrapper: Wrapper });

        // The default emoji icon should be present
        expect(screen.getByText("\uD83C\uDFAD")).toBeInTheDocument();
      });
    });
  });
});
