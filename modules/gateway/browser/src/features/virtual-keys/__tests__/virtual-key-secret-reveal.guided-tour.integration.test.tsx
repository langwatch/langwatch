/**
 * @vitest-environment jsdom
 * The secret dialog's side of the guided gateway tour.
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
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../testing.tsx";

const world = vi.hoisted(() => ({
  registered: { current: {} } as { current: Partial<GuidedTourActions> },
  declarations: { current: undefined as UiDeclarations | undefined },
}));

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUiDeclarations: () => world.declarations.current,
}));

import { VirtualKeySecretReveal } from "../ui/sections/virtual-key-secret-reveal.tsx";

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

const renderReveal = () =>
  renderWithGatewayHost(
    <VirtualKeySecretReveal
      open
      onClose={() => undefined}
      keyName="production-app"
      secret="secret-marker"
    />,
    { host: fakeGatewayHost() },
  );

describe("given the gateway tour on the secret step", () => {
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

  describe("when the secret dialog is open", () => {
    it("masks the secret until the tour's cursor lands on it", () => {
      renderReveal();
      expect(screen.getByTestId("gateway-virtual-key-secret")).not.toHaveTextContent(
        "secret-marker",
      );
      act(() => world.registered.current.revealVirtualKeySecret?.());
      expect(screen.getByTestId("gateway-virtual-key-secret")).toHaveTextContent("secret-marker");
    });

    it("marks the secret row as the vk-secret tour target", () => {
      renderReveal();
      const target = document.querySelector('[data-tour="vk-secret"]');
      expect(target).toContainElement(screen.getByTestId("gateway-virtual-key-secret"));
    });

    it("takes the action back when the dialog unmounts", () => {
      const { unmount } = renderReveal();
      expect(world.registered.current.revealVirtualKeySecret).toBeTypeOf("function");
      unmount();
      expect(world.registered.current.revealVirtualKeySecret).toBeUndefined();
    });
  });
});
