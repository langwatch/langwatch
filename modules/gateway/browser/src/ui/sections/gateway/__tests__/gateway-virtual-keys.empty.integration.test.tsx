/**
 * @vitest-environment jsdom
 * Characterizes the virtual keys page before any key exists.
 */
import { cleanup, screen } from "@testing-library/react";
import type React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../../testing.tsx";

vi.mock("../../../../ui/sections/gateway-layout.tsx", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../../../../features/virtual-keys/ui/sections/virtual-key-create-drawer.tsx", () => ({
  VirtualKeyCreateDrawer: () => null,
}));
vi.mock("../../../../features/virtual-keys/ui/sections/virtual-key-edit-drawer.tsx", () => ({
  VirtualKeyEditDrawer: () => null,
}));
vi.mock("../../../../features/virtual-keys/ui/sections/virtual-key-secret-reveal.tsx", () => ({
  VirtualKeySecretReveal: () => null,
}));

vi.mock("../../../../behavior/gateway-api.ts", () => {
  const empty = () => ({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  return {
    api: {
      useUtils: () => ({ virtualKeys: { list: { invalidate: vi.fn() } } }),
      virtualKeys: {
        list: { useQuery: empty },
        spendThisMonth: { useQuery: empty },
        rotate: { useMutation: () => ({ mutateAsync: vi.fn() }) },
        revoke: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      },
      routingPolicy: { list: { useQuery: empty } },
    },
  };
});

import VirtualKeysPage from "../gateway-virtual-keys.screen.tsx";

function renderPage(permissions: readonly string[]) {
  return renderWithGatewayHost(<VirtualKeysPage />, {
    host: fakeGatewayHost({
      permissions,
      organization: { id: "org-1", name: "ACME", slug: "acme", teams: [] },
      project: null,
    }),
  });
}

afterEach(() => cleanup());

describe("virtual keys page", () => {
  describe("when no key exists", () => {
    it("invites a creator to mint the first key", () => {
      renderPage(["virtualKeys:manage"]);

      expect(screen.getByText("No virtual keys yet")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /New virtual key/ })).toHaveLength(2);
    });

    it("offers no create button to a viewer", () => {
      renderPage([]);

      expect(screen.getByText("No virtual keys yet")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /New virtual key/ })).not.toBeInTheDocument();
    });
  });
});
