// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * What the inventory page lends the guided tour: the action that opens the
 * header's Add source menu, which the governance tour ends on, and the
 * target the tour's cursor lands on to do it.
 *
 * Spec: specs/features/onboarding/guided-tour.feature
 */
import "@testing-library/jest-dom/vitest";
import { act, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getTourActions,
  useTourRegistry,
} from "~/features/guided-onboarding/tour/tourRegistry";

import { connectTools, renderScreen } from "./inventoryScreenHarness";

describe("given an admin on the Inventory page", () => {
  beforeEach(() => {
    useTourRegistry.setState({ actions: {} });
    connectTools();
  });

  describe("when the guided tour asks for the Add source menu", () => {
    /** @scenario "the governance tour ends with the Add source menu open" */
    it("opens the header's menu through the registered action, listing the source types", async () => {
      renderScreen();
      const button = screen.getByRole("button", { name: /Add source/ });
      expect(button).toHaveAttribute("data-tour", "gov-add-source");
      expect(
        screen.queryByRole("menuitem", { name: /Anthropic Admin API/ }),
      ).toBeNull();

      act(() => getTourActions().openAddSourceMenu?.());

      expect(
        await screen.findByRole("menuitem", { name: /Anthropic Admin API/ }),
      ).toBeInTheDocument();
    });

    /** @scenario "a page registers tour actions on mount and removes them on unmount" */
    it("lends the action while mounted and takes it back on unmount", () => {
      const { unmount } = renderScreen();
      expect(getTourActions().openAddSourceMenu).toBeDefined();
      unmount();
      expect(getTourActions().openAddSourceMenu).toBeUndefined();
    });
  });
});
