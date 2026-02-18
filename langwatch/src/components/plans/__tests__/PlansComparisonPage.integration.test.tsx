/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { PlansComparisonPage } from "../PlansComparisonPage";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

afterEach(() => {
  cleanup();
});

describe("<PlansComparisonPage/>", () => {
  describe("when a member opens the plans comparison page", () => {
    it("shows the plans comparison layout with three plan columns", () => {
      render(
        <PlansComparisonPage activePlan={{ type: "FREE", free: true }} />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByRole("heading", { name: "Plans" }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("plan-column-free")).toBeInTheDocument();
      expect(screen.getByTestId("plan-column-growth")).toBeInTheDocument();
      expect(screen.getByTestId("plan-column-enterprise")).toBeInTheDocument();
      expect(screen.queryByText(/access denied/i)).not.toBeInTheDocument();
    });
  });

  describe("when organization is on the Free plan", () => {
    it("marks the Free column as current", () => {
      render(
        <PlansComparisonPage activePlan={{ type: "FREE", free: true }} />,
        { wrapper: Wrapper },
      );

      const freeColumn = screen.getByTestId("plan-column-free");
      expect(within(freeColumn).getByText("Current")).toBeInTheDocument();
    });

    it("routes growth upgrade action to subscription page", () => {
      render(
        <PlansComparisonPage activePlan={{ type: "FREE", free: true }} />,
        { wrapper: Wrapper },
      );

      const growthColumn = screen.getByTestId("plan-column-growth");
      const upgradeLink = within(growthColumn).getByRole("link", {
        name: "Upgrade Now",
      });
      expect(upgradeLink).toHaveAttribute("href", "/settings/subscription");
    });
  });

  describe("when organization is on the Growth plan", () => {
    it("marks the Growth column as current", () => {
      render(
        <PlansComparisonPage
          activePlan={{ type: "GROWTH_SEAT_EVENT", free: false }}
        />,
        { wrapper: Wrapper },
      );

      const growthColumn = screen.getByTestId("plan-column-growth");
      expect(within(growthColumn).getByText("Current")).toBeInTheDocument();
      expect(
        within(screen.getByTestId("plan-column-free")).queryByText("Current"),
      ).not.toBeInTheDocument();
      expect(
        within(screen.getByTestId("plan-column-enterprise")).queryByText(
          "Current",
        ),
      ).not.toBeInTheDocument();
    });

    it("shows seat and usage pricing details", () => {
      render(
        <PlansComparisonPage
          activePlan={{ type: "GROWTH_SEAT_EVENT", free: false }}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("$32 per seat/month")).toBeInTheDocument();
      const growthColumn = screen.getByTestId("plan-column-growth");
      expect(
        within(growthColumn).getByRole("link", { name: "Add Members" }),
      ).toBeInTheDocument();
    });
  });

  describe("when organization is on the Enterprise plan", () => {
    it("marks the Enterprise column as current", () => {
      render(
        <PlansComparisonPage
          activePlan={{ type: "ENTERPRISE", free: false }}
        />,
        { wrapper: Wrapper },
      );

      const enterpriseColumn = screen.getByTestId("plan-column-enterprise");
      expect(within(enterpriseColumn).getByText("Current")).toBeInTheDocument();
      expect(
        within(screen.getByTestId("plan-column-free")).queryByText("Current"),
      ).not.toBeInTheDocument();
      expect(
        within(screen.getByTestId("plan-column-growth")).queryByText("Current"),
      ).not.toBeInTheDocument();
    });
  });

  describe("when organization is on a legacy tier plan", () => {
    it("shows no current plan badge in comparison columns", () => {
      render(
        <PlansComparisonPage activePlan={{ type: "LAUNCH", free: false }} />,
        { wrapper: Wrapper },
      );

      expect(
        within(screen.getByTestId("plan-column-free")).queryByText("Current"),
      ).not.toBeInTheDocument();
      expect(
        within(screen.getByTestId("plan-column-growth")).queryByText("Current"),
      ).not.toBeInTheDocument();
      expect(
        within(screen.getByTestId("plan-column-enterprise")).queryByText(
          "Current",
        ),
      ).not.toBeInTheDocument();
    });

    it("shows discontinued pricing notice for TIERED organizations", () => {
      render(
        <PlansComparisonPage
          activePlan={{ type: "LAUNCH", free: false }}
          pricingModel="TIERED"
        />,
        { wrapper: Wrapper },
      );

      const notice = screen.getByTestId("tiered-discontinued-notice");
      expect(notice).toBeInTheDocument();
      expect(notice).toHaveTextContent(/pricing model has been discontinued/i);

      const link = within(notice).getByRole("link", {
        name: /update your plan/i,
      });
      expect(link).toHaveAttribute("href", "/settings/subscription");
    });

    it("does not show discontinued pricing notice for SEAT_EVENT organizations", () => {
      render(
        <PlansComparisonPage
          activePlan={{ type: "GROWTH_SEAT_EVENT", free: false }}
          pricingModel="SEAT_EVENT"
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.queryByTestId("tiered-discontinued-notice"),
      ).not.toBeInTheDocument();
    });
  });

  describe("when comparing enterprise plan options", () => {
    it("shows enterprise commercial highlights and sales action", () => {
      render(
        <PlansComparisonPage activePlan={{ type: "FREE", free: true }} />,
        { wrapper: Wrapper },
      );

      const enterpriseColumn = screen.getByTestId("plan-column-enterprise");
      expect(
        within(enterpriseColumn).getByText("Custom pricing"),
      ).toBeInTheDocument();
      expect(
        within(enterpriseColumn).getByRole("link", { name: "Talk to Sales" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Custom SSO / RBAC")).toBeInTheDocument();
      expect(screen.getByText("Uptime & Support SLA")).toBeInTheDocument();
    });
  });
});
