/**
 * @vitest-environment jsdom
 * The routing-policy drawer validates on submit: Create stays enabled, names every problem
 * and focuses the first.
 */
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeGatewayHost, renderWithGatewayHost } from "../testing.tsx";

const { createMutate } = vi.hoisted(() => ({ createMutate: vi.fn() }));

vi.mock("@langwatch/design-system/scope-chip-picker", () => ({
  ScopeChipPicker: () => <div data-testid="scope-chip-picker" />,
}));

vi.mock("../behavior/gateway-api.ts", () => ({
  api: {
    useUtils: () => ({ routingPolicy: { list: { invalidate: vi.fn() } } }),
    routingPolicy: {
      list: { useQuery: () => ({ data: [], isLoading: false }) },
      setDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      get: { useQuery: () => ({ data: void 0, isLoading: false }) },
      tierSuggestions: { useQuery: () => ({ data: [], isLoading: false }) },
      create: { useMutation: () => ({ mutate: createMutate, isPending: false }) },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    modelProvider: {
      listAllForOrganizationForFrontend: { useQuery: () => ({ data: [], isLoading: false }) },
    },
  },
}));

import { RoutingPolicyDrawer } from "../features/routing-policies/ui/sections/routing-policy-drawer.tsx";

describe("given a new routing policy with nothing filled in", () => {
  afterEach(() => cleanup());

  describe("when Create policy is pressed", () => {
    it("stays enabled, names the problems, focuses the name and creates nothing", async () => {
      renderWithGatewayHost(<RoutingPolicyDrawer onClose={vi.fn()} />, {
        host: fakeGatewayHost({
          permissions: ["routingPolicies:manage"],
          organization: { id: "org-1", name: "ACME", slug: "acme", teams: [] },
          project: null,
        }),
      });
      const create = screen.getByRole("button", { name: "Create policy" });
      expect(create).toHaveProperty("disabled", false);

      await userEvent.click(create);

      expect(await screen.findByText("Give the policy a name")).toBeInTheDocument();
      expect(screen.getByText("Pick where this policy applies")).toBeInTheDocument();
      expect(screen.getByText("Pick at least one model provider")).toBeInTheDocument();
      expect(document.activeElement).toBe(screen.getByTestId("gateway-routing-policy-name"));
      expect(createMutate).not.toHaveBeenCalled();
    });
  });
});
