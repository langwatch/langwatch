/**
 * @vitest-environment jsdom
 * Characterizes the budget detail page: its header actions, the not-found and archived states.
 */
import { cleanup, screen } from "@testing-library/react";
import type React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../../testing.tsx";

vi.mock("../../../../ui/sections/gateway-layout.tsx", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../../../../features/budgets/ui/sections/budget-edit-drawer.tsx", () => ({
  BudgetEditDrawer: () => null,
}));

const state = vi.hoisted(() => ({ budget: undefined as unknown }));

vi.mock("../../../../behavior/gateway-api.ts", () => {
  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            const isGet = path.join(".") === "gatewayBudgets.get";
            return () => ({
              data: isGet ? state.budget : undefined,
              isLoading: false,
              isError: false,
              error: null,
              refetch: vi.fn(),
            });
          }
          if (property === "useMutation") {
            return () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
          }
          if (property === "invalidate") return vi.fn();
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );
  return { api: node([]) };
});

import BudgetDetailPage from "../gateway-budget.screen.tsx";

function budget(overrides: Record<string, unknown> = {}) {
  return {
    id: "bdg-1",
    name: "Engineering monthly",
    description: "The whole team",
    scopeType: "ORGANIZATION",
    scopeTarget: { kind: "ORGANIZATION", id: "org-1", name: "ACME" },
    window: "MONTH",
    limitUsd: "100",
    spentUsd: "25",
    onBreach: "BLOCK",
    timezone: "UTC",
    resetsAt: "2026-04-01T00:00:00.000Z",
    lastResetAt: "2026-03-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    spendAvailable: true,
    unreachableByAnyKey: false,
    recentLedger: [],
    ...overrides,
  };
}

function renderPage(permissions: readonly string[]) {
  return renderWithGatewayHost(<BudgetDetailPage />, {
    host: fakeGatewayHost({ permissions, params: { id: "bdg-1" }, query: { id: "bdg-1" } }),
  });
}

const MANAGE = ["gatewayBudgets:update", "gatewayBudgets:delete"];

beforeEach(() => {
  state.budget = budget();
});
afterEach(() => cleanup());

describe("budget detail page", () => {
  describe("when the budget does not exist", () => {
    it("says so", () => {
      state.budget = undefined;
      renderPage(MANAGE);

      expect(screen.getByText("Budget not found.")).toBeInTheDocument();
    });
  });

  describe("when a manager opens a live budget", () => {
    it("offers the audit history, reset, edit and archive", () => {
      renderPage(MANAGE);

      expect(screen.getAllByText("Engineering monthly").length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: /Audit history/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Reset period/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Edit/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Archive/ })).toBeInTheDocument();
    });
  });

  describe("when a viewer opens it", () => {
    it("offers only the audit history", () => {
      renderPage([]);

      expect(screen.getByRole("button", { name: /Audit history/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Reset period/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Archive/ })).not.toBeInTheDocument();
    });
  });

  describe("when the budget is archived", () => {
    it("marks it archived and offers no changes", () => {
      state.budget = budget({ archivedAt: "2026-03-05T00:00:00.000Z" });
      renderPage(MANAGE);

      expect(screen.getByText("archived")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Reset period/ })).not.toBeInTheDocument();
    });
  });

  describe("when spend cannot be totalled", () => {
    it("warns that the budget is not enforcing", () => {
      state.budget = budget({ spendAvailable: false });
      renderPage(MANAGE);

      expect(screen.getByTestId("budget-spend-unavailable")).toBeInTheDocument();
    });
  });

  describe("when no key sends traffic to it", () => {
    it("warns that it can never stop a request", () => {
      state.budget = budget({ unreachableByAnyKey: true });
      renderPage(MANAGE);

      expect(screen.getByTestId("budget-unreachable-alert")).toBeInTheDocument();
    });
  });
});
