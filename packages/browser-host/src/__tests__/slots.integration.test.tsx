/**
 * A slot nobody filled renders the screen's own fallback.
 * Spec: specs/ui/ui-slots.feature
 */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { UiCapabilityContextProvider } from "../capabilities.ts";
import type { UiSlots } from "../slots.tsx";
import { UiSlot, UNFILLED_UI_SLOTS, uiSlots } from "../slots.tsx";
import { createUiCapabilitiesFromHost } from "../testing.ts";

function EnterpriseWall() {
  return <p>Talk to sales</p>;
}

function Screen() {
  return <UiSlot name="contactSales" props={{}} fallback={<p>Nothing more to add</p>} />;
}

const inertHost = {
  route: () => ({ params: {}, query: {} }),
  navigate: vi.fn(),
};

function withSlots(slots: UiSlots, children: ReactNode) {
  return (
    <UiCapabilityContextProvider value={{ ...createUiCapabilitiesFromHost(inertHost), slots }}>
      {children}
    </UiCapabilityContextProvider>
  );
}

describe("a slot a core screen leaves open", () => {
  describe("when no composition filled it", () => {
    /** @scenario An unfilled slot renders the core fallback */
    it("renders the screen's own fallback", () => {
      render(withSlots(UNFILLED_UI_SLOTS, <Screen />));

      expect(screen.getByText("Nothing more to add")).toBeDefined();
      expect(screen.queryByText("Talk to sales")).toBeNull();
    });

    /** @scenario An unfilled slot renders the core fallback */
    it("renders the fallback outside any shell at all, without throwing", () => {
      expect(() => render(<Screen />)).not.toThrow();
      expect(screen.getByText("Nothing more to add")).toBeDefined();
    });
  });

  describe("when the composition filled it", () => {
    /** @scenario The application fills the slot with the enterprise component */
    it("renders what the composition installed instead of the fallback", () => {
      render(withSlots(uiSlots({ components: { contactSales: EnterpriseWall } }), <Screen />));

      expect(screen.getByText("Talk to sales")).toBeDefined();
      expect(screen.queryByText("Nothing more to add")).toBeNull();
    });

    /** @scenario The application fills the slot with the enterprise component */
    it("hands the screen's props to the block it filled with", () => {
      function Alert({ provider, error }: { provider: string; error?: string }) {
        return (
          <p>
            {provider}: {error}
          </p>
        );
      }
      render(
        withSlots(
          uiSlots({ components: { managedModelProviderAlert: Alert } }),
          <UiSlot
            name="managedModelProviderAlert"
            props={{ provider: "openai", error: "no key" }}
          />,
        ),
      );

      expect(screen.getByText("openai: no key")).toBeDefined();
    });
  });
});
