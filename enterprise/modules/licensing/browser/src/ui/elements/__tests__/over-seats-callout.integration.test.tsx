/**
 * @vitest-environment jsdom
 *
 * specs/licensing/seat-reconciliation.feature: tells an admin they have
 * seats to give back — must appear exactly when true, stay quiet otherwise.
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OverSeatsCallout } from "../over-seats-callout.tsx";

describe("OverSeatsCallout", () => {
  describe("given more active members than the license covers", () => {
    /** @scenario The organization is told how many seats it has to give back */
    it("says how many members are over and offers the way out", () => {
      renderWithDesignSystem(<OverSeatsCallout currentMembers={25} maxMembers={10} />);

      expect(screen.getByText(/15 members are over the seats your license covers/i)).toBeDefined();
      expect(screen.getByText(/Choose who to disable/i)).toBeDefined();
    });

    it("reads naturally when only one member is over", () => {
      renderWithDesignSystem(<OverSeatsCallout currentMembers={11} maxMembers={10} />);

      expect(screen.getByText(/One member is over the seats your license covers/i)).toBeDefined();
    });
  });

  describe("given the organization is within its seats", () => {
    /** @scenario An organization within its seats is not told anything */
    it("renders nothing at all", () => {
      const { container } = renderWithDesignSystem(
        <OverSeatsCallout currentMembers={10} maxMembers={10} />,
      );

      expect(container.querySelector('[data-testid="over-seats-callout"]')).toBeNull();
    });
  });
});
