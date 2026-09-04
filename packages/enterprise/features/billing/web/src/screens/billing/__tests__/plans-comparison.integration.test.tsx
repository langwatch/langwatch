/**
 * @vitest-environment jsdom
 * The plans comparison page, rendered against a mocked `billingApi`.
 * @see specs/features/settings-plans-comparison.feature
 */
import "@testing-library/jest-dom/vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlansComparisonPage } from "../plans-comparison";

vi.mock("../../../behavior/billing-api", () => ({
  billingApi: {
    currency: {
      detectCurrency: {
        useQuery: () => ({ data: { currency: "EUR" }, isLoading: false }),
      },
    },
  },
}));

function renderPlans(props: Parameters<typeof PlansComparisonPage>[0] = {}) {
  return render(<PlansComparisonPage {...props} />, {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
    ),
  });
}

function column(id: "free" | "growth" | "enterprise") {
  return screen.getByTestId(`plan-column-${id}`);
}

function isMarkedCurrent(id: "free" | "growth" | "enterprise") {
  return within(column(id)).queryByText("Current") !== null;
}

afterEach(() => cleanup());

describe("PlansComparisonPage", () => {
  describe("given a member without administrative rights", () => {
    describe("when the comparison is opened", () => {
      /** @scenario "Non-admin members can access plans comparison" */
      it("renders the Free, Growth and Enterprise columns with no access-denied state", () => {
        renderPlans();

        expect(within(column("free")).getByText("Free")).toBeInTheDocument();
        expect(within(column("growth")).getByText("Growth")).toBeInTheDocument();
        expect(within(column("enterprise")).getByText("Enterprise")).toBeInTheDocument();
        expect(screen.queryByText(/access denied/i)).not.toBeInTheDocument();
      });
    });
  });

  describe("given an organization on the Growth plan", () => {
    describe("when the comparison is viewed", () => {
      /** @scenario "Growth organizations see Growth as current" */
      it("marks Growth as current and no other column", () => {
        renderPlans({ activePlan: { type: "GROWTH", free: false } });

        expect(isMarkedCurrent("growth")).toBe(true);
        expect(isMarkedCurrent("free")).toBe(false);
        expect(isMarkedCurrent("enterprise")).toBe(false);
      });
    });
  });

  describe("given an organization on a legacy tier this comparison does not show", () => {
    describe("when the comparison is viewed", () => {
      /** @scenario "Legacy tier organizations show no current plan in comparison" */
      it("marks no column as current", () => {
        renderPlans({ activePlan: { type: "LAUNCH", free: false } });

        expect(isMarkedCurrent("free")).toBe(false);
        expect(isMarkedCurrent("growth")).toBe(false);
        expect(isMarkedCurrent("enterprise")).toBe(false);
      });
    });
  });

  describe("given a reader looking at the usage lines", () => {
    describe("when the comparison is viewed", () => {
      /** @scenario "Plan usage lines link to the list of billable events" */
      it("offers the billable events documentation in a new tab", () => {
        renderPlans();

        const link = screen.getByTestId("billable-events-docs-link");
        expect(link).toHaveTextContent("What counts as an event?");
        expect(link).toHaveAttribute("href", "https://docs.langwatch.ai/pricing/billable-events");
        expect(link).toHaveAttribute("target", "_blank");
      });
    });
  });

  describe("given an organization on the discontinued tiered pricing model", () => {
    describe("when the comparison is viewed", () => {
      /** @scenario "TIERED organizations see a discontinued plan migration notice" */
      it("shows the discontinued notice linking to the subscription page", () => {
        renderPlans({ activePlan: { type: "LAUNCH", free: false }, pricingModel: "TIERED" });

        const notice = screen.getByTestId("tiered-discontinued-notice");
        expect(notice).toHaveTextContent("Your current pricing model has been discontinued.");
        expect(within(notice).getByText("Update your plan")).toHaveAttribute(
          "href",
          "/settings/subscription",
        );
      });
    });
  });
});
