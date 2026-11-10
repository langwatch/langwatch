/**
 * @vitest-environment jsdom
 *
 * The traces page line shown while the organization is over its plan.
 * @see specs/billing/over-plan-trace-withholding.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { OverPlanNotice } from "../over-plan-notice.tsx";

afterEach(cleanup);

describe("<OverPlanNotice />", () => {
  describe("given an organization over its plan with 5 members and 4 withheld traces", () => {
    /** @scenario "The traces page shows one line with the numbers and both actions" */
    it("shows the numbers and links both actions", () => {
      renderWithDesignSystem(<OverPlanNotice withheld={{ count: 4, members: 5, maxMembers: 2 }} />);

      expect(
        screen.getByText(
          "Your plan covers 2 members and you have 5. New traces are saved and will show once you update your card or remove 3 members.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Update card" })).toHaveAttribute(
        "href",
        "/settings/subscription?updateCard=1",
      );
      expect(screen.getByRole("link", { name: "Manage members" })).toHaveAttribute(
        "href",
        "/settings/members",
      );
    });

    it("says one member when only one has to go", () => {
      renderWithDesignSystem(<OverPlanNotice withheld={{ count: 1, members: 3, maxMembers: 2 }} />);

      expect(screen.getByText(/remove 1 member\.$/)).toBeInTheDocument();
    });
  });

  describe("given an organization on the Free plan with no over-plan state", () => {
    /** @scenario "The traces page shows no line when nothing is withheld" */
    it("shows no over-plan line", () => {
      renderWithDesignSystem(<OverPlanNotice withheld={null} />);

      expect(screen.queryByTestId("over-plan-notice")).not.toBeInTheDocument();
    });
  });
});
