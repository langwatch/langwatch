/**
 * @vitest-environment jsdom
 *
 * See specs/licensing/seat-reconciliation.feature — the callout is what tells
 * an admin they have seats to give back, so it has to appear exactly when that
 * is true and stay quiet otherwise.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OverSeatsCallout } from "../OverSeatsCallout";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("OverSeatsCallout", () => {
  describe("given more active members than the license covers", () => {
    /** @scenario The organization is told how many seats it has to give back */
    it("says how many members are over and offers the way out", () => {
      render(<OverSeatsCallout currentMembers={25} maxMembers={10} />, {
        wrapper: Wrapper,
      });

      expect(
        screen.getByText(/15 members are over the seats your license covers/i),
      ).toBeDefined();
      expect(screen.getByText(/Choose who to disable/i)).toBeDefined();
    });

    it("reads naturally when only one member is over", () => {
      render(<OverSeatsCallout currentMembers={11} maxMembers={10} />, {
        wrapper: Wrapper,
      });

      expect(
        screen.getByText(/One member is over the seats your license covers/i),
      ).toBeDefined();
    });
  });

  describe("given the organization is within its seats", () => {
    /** @scenario An organization within its seats is not told anything */
    it("renders nothing at all", () => {
      const { container } = render(
        <OverSeatsCallout currentMembers={10} maxMembers={10} />,
        { wrapper: Wrapper },
      );

      expect(container.querySelector('[data-testid="over-seats-callout"]')).toBeNull();
    });
  });
});
