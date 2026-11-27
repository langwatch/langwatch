/**
 * @vitest-environment jsdom
 * The subscription accounts section, driven through its tRPC query boundary (mocked).
 * @see specs/coding-agent/account-burndown.feature
 */
import type {
  CodingAgentAccountBurndown,
  CodingAgentAccountBurndownPage,
} from "@langwatch/coding-agent-contract";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { nowEpochMs } from "@langwatch/time";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type QueryState = {
  data?: CodingAgentAccountBurndownPage;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  refetch: () => unknown;
};

const refetch = vi.fn();
let queryState: QueryState = { isLoading: true, isError: false, refetch };

vi.mock("../behavior/personal-workspace-api.ts", () => ({
  api: {
    codingAgents: {
      accountBurndown: {
        useQuery: () => queryState,
      },
    },
  },
}));

import { SubscriptionAccountsSection } from "../ui/sections/subscription-accounts-section.tsx";

const DAYS = ["20", "21", "22", "23", "24", "25", "26"].map((day) => `2026-11-${day}`);

function account(over: Partial<CodingAgentAccountBurndown> = {}): CodingAgentAccountBurndown {
  return {
    accountId: "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
    name: "ACME Max 1",
    source: "pool",
    agents: ["claude_code", "codex"],
    topModels: ["claude-opus-5-5"],
    days: DAYS.map((day, index) => ({
      day,
      inputTokens: 1000 * index,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: index,
    })),
    totals: {
      inputTokens: 21_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 21_000,
      costUsd: 21,
    },
    reading: {
      percent: 72.4,
      window: "seven_day",
      resetsAtMs: Date.parse("2026-11-28T09:00:00.000Z"),
      readAtMs: Date.parse("2026-11-26T11:00:00.000Z"),
      limitedUntilMs: null,
    },
    rateLimitEvents: 0,
    ...over,
  };
}

function renderWith(accounts: CodingAgentAccountBurndown[]) {
  queryState = {
    isLoading: false,
    isError: false,
    refetch,
    data: { accounts },
  };
  return renderSection();
}

function renderSection() {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <SubscriptionAccountsSection projectId="p1" />
    </DesignSystemProvider>,
  );
}

describe("SubscriptionAccountsSection", () => {
  afterEach(cleanup);

  describe("given an account with a reading", () => {
    /** @scenario the week shows tokens and cost per day */
    it("shows the percent, when it was read, the reset, the week's tokens and its cost", () => {
      renderWith([account()]);
      const card = screen.getByTestId("subscription-account");

      expect(within(card).getByText("ACME Max 1")).toBeTruthy();
      expect(within(card).getByText("72%")).toBeTruthy();
      expect(within(card).getByText("of the weekly window used")).toBeTruthy();
      expect(within(card).getByText(/As of .*26 Nov/)).toBeTruthy();
      expect(within(card).getByText(/Resets .*28 Nov/)).toBeTruthy();
      expect(within(card).getAllByTestId("daily-bar")).toHaveLength(7);
      expect(within(card).getByText("21.0K")).toBeTruthy();
      expect(within(card).getByText("$21.00")).toBeTruthy();
      expect(
        within(card).getByText(/Claude Code, Codex · claude-opus-5-5 · Shared pool/),
      ).toBeTruthy();
    });
  });

  describe("given an account out of usage", () => {
    /** @scenario an account out of usage says until when */
    it("says until when", () => {
      renderWith([
        account({
          reading: {
            percent: 100,
            window: "five_hour",
            resetsAtMs: null,
            readAtMs: null,
            limitedUntilMs: nowEpochMs() + 60 * 60 * 1000,
          },
        }),
      ]);

      expect(screen.getByText(/Out of usage until (\d{2}:\d{2}|.* \d+ \w{3}, )/)).toBeTruthy();
    });

    it("drops the badge once the limit has passed", () => {
      renderWith([
        account({
          reading: { ...account().reading!, limitedUntilMs: nowEpochMs() - 60_000 },
        }),
      ]);

      expect(screen.queryByText(/Out of usage until/)).toBeNull();
    });

    it("keeps every re-check timer within what setTimeout can wait for a limit weeks away", () => {
      const timers = vi.spyOn(globalThis, "setTimeout");
      renderWith([
        account({
          reading: { ...account().reading!, limitedUntilMs: nowEpochMs() + 60 * 86_400_000 },
        }),
      ]);

      expect(screen.getByText(/Out of usage until/)).toBeTruthy();
      const delays = timers.mock.calls.map(([, delay]) => delay ?? 0);
      timers.mockRestore();
      expect(delays.every((delay) => delay <= 2_147_483_647)).toBe(true);
    });
  });

  describe("given an account that reported no percent", () => {
    /** @scenario no percent is shown when none was reported */
    it("shows no percent and says none was reported", () => {
      renderWith([account({ reading: null })]);

      expect(screen.getByText("No usage figure reported yet")).toBeTruthy();
      expect(screen.queryByTestId("subscription-account-meter")).toBeNull();
    });

    it("still shows the reset the account reported", () => {
      renderWith([account({ reading: { ...account().reading!, percent: null } })]);

      expect(screen.getByText("No usage figure reported yet")).toBeTruthy();
      expect(screen.getByText(/Resets .*28 Nov/)).toBeTruthy();
    });
  });

  describe("given a viewer who may not see costs", () => {
    it("shows the tokens without a cost", () => {
      renderWith([account({ totals: { ...account().totals, costUsd: null } })]);

      expect(screen.queryByText("$21.00")).toBeNull();
      expect(screen.getByText("21.0K")).toBeTruthy();
    });
  });

  describe("given the read failed", () => {
    it("offers a retry when nothing loaded", () => {
      queryState = { isLoading: false, isError: true, error: new Error("boom"), refetch };
      renderSection();

      screen.getByText("Try again").click();
      expect(screen.getByText("Couldn't load subscription accounts")).toBeTruthy();
      expect(refetch).toHaveBeenCalled();
    });

    it("keeps the cards when a refresh fails", () => {
      queryState = {
        isLoading: false,
        isError: true,
        error: new Error("boom"),
        refetch,
        data: { accounts: [account()] },
      };
      renderSection();

      expect(screen.getByText("ACME Max 1")).toBeTruthy();
      expect(screen.getByText("Couldn't refresh subscription accounts")).toBeTruthy();
    });

    it("shows the failed refresh beside an empty week", () => {
      queryState = {
        isLoading: false,
        isError: true,
        error: new Error("boom"),
        refetch,
        data: { accounts: [] },
      };
      renderSection();

      expect(screen.getByText("No subscription accounts this week")).toBeTruthy();
      expect(screen.getByText("Couldn't refresh subscription accounts")).toBeTruthy();
      screen.getByText("Try again").click();
      expect(refetch).toHaveBeenCalled();
    });
  });

  describe("given no account this week", () => {
    /** @scenario no subscription accounts yet */
    it("says none were reported and links the docs", () => {
      renderWith([]);

      expect(screen.getByText("No subscription accounts this week")).toBeTruthy();
      expect(screen.getByText("Subscription accounts", { selector: "a, a *" })).toBeTruthy();
    });
  });
});
