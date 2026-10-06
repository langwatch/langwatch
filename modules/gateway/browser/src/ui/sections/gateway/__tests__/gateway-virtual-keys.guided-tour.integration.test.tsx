/**
 * @vitest-environment jsdom
 * The virtual keys page's side of the guided gateway tour.
 * Spec: specs/features/onboarding/guided-tour.feature
 */
import "@testing-library/jest-dom/vitest";
import { uiDeclarations, type UiDeclarations } from "@langwatch/browser-host/declarations";
import {
  GuidedTourToken,
  type GuidedTourActions,
  type GuidedTourHooks,
} from "@langwatch/onboarding-contract";
import { act, cleanup, screen } from "@testing-library/react";
import type React from "react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../../testing.tsx";

const world = vi.hoisted(() => ({
  registered: { current: {} } as { current: Partial<GuidedTourActions> },
  declarations: { current: undefined as UiDeclarations | undefined },
}));

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUiDeclarations: () => world.declarations.current,
}));
vi.mock("../../../../ui/sections/gateway-layout.tsx", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../../../../features/virtual-keys/ui/sections/virtual-key-create-drawer.tsx", () => ({
  VirtualKeyCreateDrawer: ({ open }: { open: boolean }) =>
    open ? <p>create drawer open</p> : null,
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

const lentTour: GuidedTourHooks = {
  useRegisterActions: (actions) => {
    useEffect(() => {
      const registry = world.registered;
      registry.current = { ...actions };
      return () => {
        registry.current = {};
      };
    }, [actions]);
  },
  useRecordVirtualKeyReveal: () => async () => undefined,
};

const renderPage = () =>
  renderWithGatewayHost(<VirtualKeysPage />, {
    host: fakeGatewayHost({
      permissions: ["virtualKeys:manage"],
      organization: { id: "org-1", name: "ACME", slug: "acme", teams: [] },
      project: null,
    }),
  });

describe("given onboarding lends the guided tour", () => {
  beforeEach(() => {
    world.registered.current = {};
    world.declarations.current = uiDeclarations([
      {
        name: "onboarding",
        installation: { capabilities: {}, lends: [{ token: GuidedTourToken, value: lentTour }] },
      },
    ]);
  });

  afterEach(() => cleanup());

  describe("when the virtual keys page is mounted", () => {
    /** @scenario a page registers tour actions on mount and removes them on unmount */
    it("registers openVirtualKeyCreate, and takes it back when the page unmounts", () => {
      const { unmount } = renderPage();
      expect(world.registered.current.openVirtualKeyCreate).toBeTypeOf("function");
      unmount();
      expect(world.registered.current.openVirtualKeyCreate).toBeUndefined();
    });

    it("opens the create drawer through the action, as the New key button does", () => {
      renderPage();
      expect(screen.queryByText("create drawer open")).not.toBeInTheDocument();
      act(() => world.registered.current.openVirtualKeyCreate?.());
      expect(screen.getByText("create drawer open")).toBeInTheDocument();
    });

    it("marks the New key button as the gw-new-key tour target", () => {
      renderPage();
      const targets = document.querySelectorAll('[data-tour="gw-new-key"]');
      expect(targets).toHaveLength(1);
      expect(targets[0]).toHaveTextContent("New virtual key");
    });
  });
});

describe("given no module lends the guided tour", () => {
  afterEach(() => cleanup());

  it("mounts the page and registers nothing", () => {
    world.registered.current = {};
    world.declarations.current = uiDeclarations([]);
    renderPage();
    expect(screen.getByText("Virtual Keys")).toBeInTheDocument();
    expect(world.registered.current).toEqual({});
  });
});
