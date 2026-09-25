/**
 * @vitest-environment jsdom
 * Characterizes the cache rules list: its loading, error, empty and populated states.
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../../testing.tsx";

vi.mock("../../../../ui/sections/gateway-layout.tsx", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const state = vi.hoisted(() => ({
  list: { data: undefined as unknown, isLoading: false, isError: false },
  updateCalls: [] as unknown[],
}));

vi.mock("../../../../behavior/gateway-api.ts", () => {
  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            const isList = path.join(".") === "gatewayCacheRules.list";
            return () => ({
              data: isList ? state.list.data : undefined,
              isLoading: isList && state.list.isLoading,
              isError: isList && state.list.isError,
              error: isList && state.list.isError ? new Error("boom") : null,
              refetch: vi.fn(),
            });
          }
          if (property === "useMutation") {
            const key = path.join(".");
            return () => ({
              mutate: vi.fn(),
              mutateAsync: async (input: unknown) => {
                if (key === "gatewayCacheRules.update") state.updateCalls.push(input);
              },
              isPending: false,
            });
          }
          if (property === "invalidate") return vi.fn();
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );

  return { api: node([]) };
});

import CacheRulesPage from "../gateway-cache-rules.screen.tsx";

const RULE = {
  id: "cr-1",
  organizationId: "org-1",
  name: "Force cache for docs bot",
  description: "Docs traffic",
  priority: 200,
  enabled: true,
  matchers: { model: "openai/gpt-5-mini" },
  action: { mode: "force" },
  modeEnum: "FORCE",
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function renderPage(permissions: readonly string[]) {
  return renderWithGatewayHost(<CacheRulesPage />, {
    host: fakeGatewayHost({
      permissions,
      organization: { id: "org-1", name: "ACME", slug: "acme", teams: [] },
      project: null,
    }),
  });
}

const ALL = ["gatewayCacheRules:create", "gatewayCacheRules:update", "gatewayCacheRules:delete"];

beforeEach(() => {
  state.list = { data: [RULE], isLoading: false, isError: false };
  state.updateCalls = [];
});
afterEach(() => cleanup());

describe("cache rules page", () => {
  describe("when the rules fail to load", () => {
    it("shows the error panel", () => {
      state.list = { data: undefined, isLoading: false, isError: true };
      renderPage(ALL);

      expect(screen.getByText("Failed to load cache rules")).toBeInTheDocument();
      expect(screen.queryByText("No cache rules yet")).not.toBeInTheDocument();
    });
  });

  describe("when there are no rules", () => {
    it("shows the empty state with a create button for a creator", () => {
      state.list = { data: [], isLoading: false, isError: false };
      renderPage(ALL);

      expect(screen.getByText("No cache rules yet")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /New rule/ })).toHaveLength(2);
    });

    it("offers no create button without the create grant", () => {
      state.list = { data: [], isLoading: false, isError: false };
      renderPage([]);

      expect(screen.getByText("No cache rules yet")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /New rule/ })).not.toBeInTheDocument();
    });
  });

  describe("when rules exist", () => {
    it("lists each rule with its priority, description, match and action", () => {
      renderPage(ALL);

      expect(screen.getByText("Force cache for docs bot")).toBeInTheDocument();
      expect(screen.getByText("Docs traffic")).toBeInTheDocument();
      expect(screen.getByText("200")).toBeInTheDocument();
      expect(screen.getByText(/model=openai\/gpt-5-mini/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Actions" })).toBeInTheDocument();
    });

    it("toggles a rule off when its switch is flipped", async () => {
      renderPage(ALL);

      fireEvent.click(screen.getByRole("checkbox"));

      await waitFor(() =>
        expect(state.updateCalls).toEqual([
          { organizationId: "org-1", id: "cr-1", enabled: false },
        ]),
      );
    });

    it("hides the actions and disables the switch for a viewer", () => {
      renderPage([]);

      expect(screen.queryByRole("button", { name: "Actions" })).not.toBeInTheDocument();
      expect(screen.getByRole("checkbox")).toBeDisabled();
    });
  });
});
