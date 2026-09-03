/**
 * @vitest-environment jsdom
 *
 * The /me budgets block: every budget that binds the user renders as
 * one labelled row, so an organization-wide cap can never read as a
 * personal one.
 *
 * @see specs/ai-gateway/budget-overview.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { type BudgetOverviewItemView, BudgetOverviewList } from "../budget-overview-list";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function item(overrides: Partial<BudgetOverviewItemView> = {}): BudgetOverviewItemView {
  return {
    id: "b_org",
    name: "Org monthly",
    scopeClass: "organization",
    scopePhrase: "whole organization budget",
    scopeLabel: "ACME",
    window: "MONTH",
    limitUsd: "100.000000",
    spentUsd: "2.430000",
    onBreach: "BLOCK",
    providerLabel: null,
    isPerMember: false,
    resetsAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("<BudgetOverviewList/>", () => {
  afterEach(cleanup);

  describe("given an organization budget and a personal budget", () => {
    /** @scenario "A member sees every budget that binds their key, labelled with its scope" */
    it("renders one labelled row per budget with its spend and limit", () => {
      render(
        <BudgetOverviewList
          items={[
            item({
              id: "b_personal",
              name: "Member cap",
              scopeClass: "personal",
              scopePhrase: "personal budget",
              limitUsd: "25.000000",
              spentUsd: "0.100000",
            }),
            item(),
          ]}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("(personal budget)")).toBeInTheDocument();
      expect(screen.getByText("(whole organization budget)")).toBeInTheDocument();
      expect(screen.getByText("$2.43")).toBeInTheDocument();
      expect(screen.getByText("$100.00")).toBeInTheDocument();
      expect(screen.getByText("$25.00")).toBeInTheDocument();
      // Sub-dollar spend keeps the shared formatter's trimmed precision.
      expect(screen.getByText("$0.1")).toBeInTheDocument();
      expect(screen.getAllByText(/resets Aug 1/)).toHaveLength(2);
    });
  });

  describe("given a provider-filtered budget", () => {
    /** @scenario "A provider-filtered budget names its provider" */
    it("says which provider the budget counts", () => {
      render(<BudgetOverviewList items={[item({ providerLabel: "OpenAI" })]} />, {
        wrapper: Wrapper,
      });
      expect(screen.getByText("(whole organization budget, OpenAI only)")).toBeInTheDocument();
    });
  });

  describe("given a per-member department budget", () => {
    it("labels it as a department budget", () => {
      render(
        <BudgetOverviewList
          items={[
            item({
              scopeClass: "department",
              scopePhrase: "department budget (Engineering)",
              isPerMember: true,
              scopeLabel: "Engineering",
              window: "WEEK",
            }),
          ]}
        />,
        { wrapper: Wrapper },
      );
      expect(screen.getByText("(department budget (Engineering))")).toBeInTheDocument();
      expect(screen.getByText(/this week/)).toBeInTheDocument();
    });
  });

  describe("given a TOTAL window budget", () => {
    it("renders no reset date", () => {
      render(<BudgetOverviewList items={[item({ window: "TOTAL", resetsAt: null })]} />, {
        wrapper: Wrapper,
      });
      expect(screen.getByText(/all time/)).toBeInTheDocument();
      expect(screen.queryByText(/resets/)).not.toBeInTheDocument();
    });
  });
});
