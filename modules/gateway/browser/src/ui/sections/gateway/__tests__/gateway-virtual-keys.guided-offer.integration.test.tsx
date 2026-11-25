/**
 * @vitest-environment jsdom
 * What the virtual keys page tells the guided offer about the gateway being in use.
 * @see specs/home/guided-onboarding-offer.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../../testing.tsx";

const world = vi.hoisted(() => ({
  keys: { data: [] as unknown[] | undefined, isError: false },
}));

vi.mock("../../../../behavior/lent-guided-onboarding-offer.tsx", () => ({
  GuidedOnboardingOffer: ({ space, spaceInUse }: { space: string; spaceInUse: boolean | null }) => (
    <p data-testid="guided-offer-probe">{`${space}:${String(spaceInUse)}`}</p>
  ),
}));
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
  const answer = (data: unknown, isError = false) => ({
    data,
    isLoading: false,
    isError,
    error: null,
    refetch: vi.fn(),
  });
  return {
    api: {
      useUtils: () => ({ virtualKeys: { list: { invalidate: vi.fn() } } }),
      virtualKeys: {
        list: { useQuery: () => answer(world.keys.data, world.keys.isError) },
        spendThisMonth: { useQuery: () => answer([]) },
        rotate: { useMutation: () => ({ mutateAsync: vi.fn() }) },
        revoke: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      },
      routingPolicy: { list: { useQuery: () => answer([]) } },
    },
  };
});

import VirtualKeysPage from "../gateway-virtual-keys.screen.tsx";

const renderPage = () =>
  renderWithGatewayHost(<VirtualKeysPage />, {
    host: fakeGatewayHost({
      permissions: ["virtualKeys:manage"],
      organization: { id: "org-1", name: "ACME", slug: "acme", teams: [] },
      project: null,
    }),
  });

const offer = () => screen.getByTestId("guided-offer-probe");

describe("the gateway home's guided offer", () => {
  afterEach(() => cleanup());

  describe("given the virtual keys failed to load over an empty list still in the cache", () => {
    /** @scenario a read that failed is not read as an empty space */
    it("tells the offer the space is unknown, so no pill shows", () => {
      world.keys = { data: [], isError: true };
      renderPage();
      expect(offer()).toHaveTextContent("gateway:null");
    });
  });

  describe("given the virtual keys answered with an empty list", () => {
    it("tells the offer the gateway is not in use", () => {
      world.keys = { data: [], isError: false };
      renderPage();
      expect(offer()).toHaveTextContent("gateway:false");
    });
  });
});
