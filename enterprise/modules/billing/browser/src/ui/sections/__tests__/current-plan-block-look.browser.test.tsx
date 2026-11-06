/**
 * Real-Chromium look of the plan card: the measured gaps, type sizes and colours of the approved
 * design, which jsdom reports as zero. Spec: specs/licensing/subscription-page.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { CurrentPlanBlock } from "../current-plan-block.tsx";

const GROWTH_FEATURES = ["Up to 20 core users", "200,000 events included", "Unlimited evals"];
const ORANGE_SOLID = "rgb(237, 137, 38)";

beforeEach(async () => {
  await page.viewport(1400, 900);
});

afterEach(cleanup);

const rect = (element: Element) => element.getBoundingClientRect();

describe("<CurrentPlanBlock/> look", () => {
  describe("given a Growth plan with its features", () => {
    beforeEach(() => {
      renderWithDesignSystem(
        <CurrentPlanBlock
          planName="Growth plan"
          pricing={{ total: "€87/mo", breakdown: "3 seats × €29" }}
          features={GROWTH_FEATURES}
          userCount={3}
          maxSeats={3}
          onUserCountClick={() => undefined}
          onManageSubscription={() => undefined}
        />,
      );
    });

    /** @scenario "The plan card keeps the approved spacing" */
    it("sets the rows box 53px below the card top and the title 10px after its dot", () => {
      const card = screen.getByTestId("current-plan-block");
      const rows = screen.getByTestId("plan-usage-rows");
      expect(Math.round(rect(rows).top - rect(card).top)).toBe(53);

      const heading = within(card).getByRole("heading", { name: "Growth plan" });
      const name = screen.getByTestId("current-plan-name");
      const dot = heading.previousElementSibling as Element;
      expect(Math.round(rect(name).left - rect(dot).right)).toBe(10);
      expect(getComputedStyle(name).fontWeight).toBe("600");
    });

    /** @scenario "The plan card keeps the approved spacing" */
    it("lists the features in 13px text on 28px lines with 12px checks", () => {
      const lines = screen.getAllByTestId("current-plan-feature");
      const text = within(lines[0]!).getByText(GROWTH_FEATURES[0]!);
      const check = lines[0]!.querySelector("svg") as SVGElement;
      expect(getComputedStyle(text).fontSize).toBe("13px");
      expect(Math.round(rect(check).width)).toBe(12);
      expect(Math.round(rect(text).left - rect(check).left)).toBe(20);
      const grid = screen.getByTestId("current-plan-features-grid");
      expect(getComputedStyle(grid).rowGap).toBe("8px");
      expect(Math.round(rect(lines[0]!).height) + 8).toBe(28);
    });
  });

  describe("given an enterprise subscription", () => {
    /** @scenario "An enterprise subscription's card offers sales contact as an orange outline" */
    it("draws Contact us to upgrade with the orange outline", () => {
      renderWithDesignSystem(
        <CurrentPlanBlock
          planName="Enterprise"
          userCount={18}
          maxSeats={25}
          contactSalesUrl="https://example.com/contact"
        />,
      );

      const contact = screen.getByTestId("contact-sales-button");
      expect(getComputedStyle(contact).borderTopColor).toBe(ORANGE_SOLID);
    });
  });
});
