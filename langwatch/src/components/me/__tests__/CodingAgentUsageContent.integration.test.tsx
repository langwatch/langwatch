/**
 * @vitest-environment jsdom
 *
 * The personal coding-agent usage card, driven through its real tRPC query
 * boundary (mocked) across load / empty / data states.
 *
 * @see specs/coding-agent/personal-usage.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type UsageState = {
  data: unknown;
  isLoading: boolean;
  isError?: boolean;
};

// A mutable boundary the mock reads, so each test picks the query state.
let usageState: UsageState = { data: undefined, isLoading: true };

vi.mock("~/utils/api", () => ({
  api: {
    codingAgents: {
      usageTotals: {
        useQuery: () => usageState,
      },
    },
  },
}));

import { CodingAgentUsageContent } from "../CodingAgentUsageContent";

function renderCard() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <CodingAgentUsageContent projectId="p1" />
    </ChakraProvider>,
  );
}

const zeroTotals = {
  sessionCount: 0,
  costUsd: 0,
  totalTokens: 0,
  activeTimeSec: 0,
  linesAdded: 0,
  linesRemoved: 0,
  commits: 0,
  pullRequests: 0,
};

describe("CodingAgentUsageContent", () => {
  afterEach(cleanup);

  describe("given the query is still loading", () => {
    it("shows skeletons, no figures", () => {
      usageState = { data: undefined, isLoading: true };
      renderCard();
      expect(screen.queryByText("Sessions")).toBeNull();
    });
  });

  describe("given the personal project has no coding-agent sessions", () => {
    /** @scenario no usage yet */
    it("pitches the setup command instead of showing zeroes", () => {
      usageState = { data: zeroTotals, isLoading: false };
      renderCard();
      expect(screen.getByText("No coding-agent usage yet")).toBeTruthy();
      expect(screen.getByText("langwatch claude")).toBeTruthy();
      expect(screen.queryByText("Sessions")).toBeNull();
    });
  });

  describe("given the user has recent coding-agent usage", () => {
    /** @scenario my recent usage at a glance */
    it("shows cost, tokens, active time, sessions and what was produced", () => {
      usageState = {
        data: {
          ...zeroTotals,
          sessionCount: 7,
          costUsd: 12.5,
          totalTokens: 4_500_000,
          activeTimeSec: 3 * 3600 + 20 * 60,
          linesAdded: 1200,
          linesRemoved: 300,
          commits: 4,
          pullRequests: 1,
        },
        isLoading: false,
      };
      renderCard();

      expect(screen.getByText("Sessions")).toBeTruthy();
      expect(screen.getByText("7")).toBeTruthy();
      expect(screen.getByText("$12.50")).toBeTruthy();
      expect(screen.getByText("4.5m")).toBeTruthy();
      expect(screen.getByText("3h 20m")).toBeTruthy();
      // Produced line summarises the outcome.
      expect(screen.getByText(/1,200 added \/ 300 removed/)).toBeTruthy();
      expect(screen.getByText(/4 commits/)).toBeTruthy();
      expect(screen.getByText(/1 PR/)).toBeTruthy();
    });
  });

  describe("given the read failed", () => {
    it("says so rather than showing stale or empty figures", () => {
      usageState = { data: undefined, isLoading: false, isError: true };
      renderCard();
      expect(screen.getByText("Couldn't load coding-agent usage")).toBeTruthy();
    });
  });
});
