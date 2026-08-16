/**
 * @vitest-environment jsdom
 *
 * The virtual-keys table's two data cells that say something a reader
 * could misread:
 *
 *   - ROUTING, whose three modes are a policy name, plain fallback, and
 *     the null glyph for a key that falls back nowhere.
 *   - SPENT THIS MONTH, which carries a period bar under the month total
 *     for keys with a cap of their own. The month figure and the bar are
 *     different measurements, so the bar's accessible label names the
 *     period it is measured over.
 *
 * jsdom does no layout, so the bar's geometry is a browser-QA claim; what
 * is asserted here is which rows get a bar at all and what it says.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard:
    () =>
    <P extends object>(Component: React.ComponentType<P>) =>
      Component,
}));

vi.mock("~/components/gateway/AiGatewayLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

// The drawers each open their own queries; the table is what is under test.
vi.mock("~/components/gateway/VirtualKeyCreateDrawer", () => ({
  VirtualKeyCreateDrawer: () => null,
}));
vi.mock("~/components/gateway/VirtualKeyEditDrawer", () => ({
  VirtualKeyEditDrawer: () => null,
}));
vi.mock("~/components/gateway/VirtualKeySecretReveal", () => ({
  VirtualKeySecretReveal: () => null,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1", slug: "acme", name: "ACME", teams: [] },
    project: undefined,
    hasPermission: () => true,
  }),
}));

const NOW = new Date("2026-03-10T21:00:00.000Z");

function key(overrides: Record<string, unknown>) {
  return {
    id: "vk-1",
    name: "key",
    description: null,
    displayPrefix: "vk-lw-abc",
    status: "active",
    scopes: [],
    config: {},
    routingMode: "NONE",
    routingPolicyId: null,
    principalUserId: null,
    principalUser: null,
    lastUsedAt: null,
    ...overrides,
  };
}

const KEYS = [
  key({ id: "vk-none", name: "no-fallback-key" }),
  key({ id: "vk-all", name: "fallback-key", routingMode: "FALLBACK_ALL" }),
  key({
    id: "vk-policy",
    name: "policy-key",
    routingMode: "POLICY",
    routingPolicyId: "rp-1",
  }),
];

const SPEND = [
  {
    virtualKeyId: "vk-none",
    spentUsd: "2.50",
    requests: 12,
    budget: {
      budgetId: "bdg-1",
      window: "DAY",
      limitUsd: "1.000000",
      periodSpentUsd: "0.500000",
      // 3 hours after the frozen clock.
      resetsAt: "2026-03-11T00:00:00.000Z",
    },
  },
  { virtualKeyId: "vk-all", spentUsd: "0", requests: 0, budget: null },
  { virtualKeyId: "vk-policy", spentUsd: "0", requests: 0, budget: null },
];

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      virtualKeys: { list: { invalidate: vi.fn() } },
    }),
    virtualKeys: {
      list: {
        useQuery: () => ({
          data: KEYS,
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
      spendThisMonth: {
        useQuery: () => ({
          data: SPEND,
          isLoading: false,
          isError: false,
          error: null,
        }),
      },
      rotate: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      revoke: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    routingPolicy: {
      list: {
        useQuery: () => ({
          data: [{ id: "rp-1", name: "EU only" }],
          isLoading: false,
        }),
      },
    },
  },
}));

import VirtualKeysPage from "../virtual-keys";

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <VirtualKeysPage />
    </ChakraProvider>,
  );
}

function rowFor(name: string): HTMLElement {
  const cell = screen.getByRole("link", { name });
  const row = cell.closest("tr");
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

describe("virtual keys table", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  describe("when the routing column renders", () => {
    /** @scenario "Virtual key list Routing column states its three modes" */
    /** @scenario The canonical gateway address renders the gateway */
    it("renders the null glyph when the key falls back nowhere", () => {
      renderPage();
      expect(within(rowFor("no-fallback-key")).getByText("—")).toBeVisible();
      expect(screen.queryByText("no fallback")).not.toBeInTheDocument();
    });

    /** @scenario "Virtual key list Routing column states its three modes" */
    it("renders a bare 'fallback' when the key falls back to any provider", () => {
      renderPage();
      expect(
        within(rowFor("fallback-key")).getByText("fallback"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("fallback: all providers"),
      ).not.toBeInTheDocument();
    });

    /** @scenario "Virtual key list Routing column states its three modes" */
    it("keeps naming the policy when one is pinned", () => {
      renderPage();
      expect(within(rowFor("policy-key")).getByText("EU only")).toBeVisible();
    });
  });

  describe("when the spend column renders", () => {
    /** @scenario "Virtual key list shows a key's own budget under its month spend" */
    it("draws a period bar for a key with a budget of its own", () => {
      renderPage();
      const bar = screen.getByTestId("vk-budget-bar-vk-none");
      expect(bar).toHaveAttribute("aria-valuenow", "0.5");
      expect(bar).toHaveAttribute("aria-valuemax", "1");
      // Amounts go through the shared gateway money formatter, the same
      // one the month total above the bar uses, so one number is never
      // written two ways inside one cell.
      expect(bar).toHaveAccessibleName(
        "$0.5 of $1.00 daily budget, resets in about 3 hours",
      );
    });

    /** @scenario "Virtual key list shows a key's own budget under its month spend" */
    it("still shows the month total next to the bar", () => {
      renderPage();
      expect(
        within(rowFor("no-fallback-key")).getByText("$2.50"),
      ).toBeInTheDocument();
    });

    /** @scenario "Virtual key list shows a key's own budget under its month spend" */
    it("draws no bar, and reserves no space, for a key with no budget", () => {
      renderPage();
      expect(
        screen.queryByTestId("vk-budget-bar-vk-all"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("vk-budget-bar-vk-policy"),
      ).not.toBeInTheDocument();
    });
  });
});
