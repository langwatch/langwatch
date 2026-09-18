/**
 * A slot nobody filled renders the screen's own fallback.
 * Spec: specs/ui/ui-slots.feature
 */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { UiCapabilityContextProvider } from "../capabilities.ts";
import { createUiCapabilitiesFromHost } from "../testing.ts";
import type { UiSlots } from "../slots.tsx";
import {
  CORE_SEAT_TYPE_COPY,
  UiSlot,
  UNFILLED_UI_SLOTS,
  uiSlots,
  useUiSeatTypeCopy,
} from "../slots.tsx";

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

    /** @scenario An unfilled slot renders the core fallback */
    it("reads the core seat-type words", () => {
      function Words() {
        return <p>{useUiSeatTypeCopy().liteMemberExplanation}</p>;
      }
      render(<Words />);

      expect(screen.getByText(CORE_SEAT_TYPE_COPY.liteMemberExplanation)).toBeDefined();
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
      function Row({ label, current, max }: { label: string; current: number; max?: number }) {
        return (
          <p>
            {label}: {current} of {max}
          </p>
        );
      }
      render(
        withSlots(
          uiSlots({ components: { resourceLimits: Row } }),
          <UiSlot name="resourceLimits" props={{ label: "Team Members", current: 3, max: 10 }} />,
        ),
      );

      expect(screen.getByText("Team Members: 3 of 10")).toBeDefined();
    });
  });
});

describe("the core seat-type words", () => {
  describe("when a composition installs none of its own", () => {
    /** @scenario An unfilled slot renders the core fallback */
    it("still says what a lite member reaches and what it hides", () => {
      const explanation = CORE_SEAT_TYPE_COPY.liteMemberExplanation;

      expect(explanation).toMatch(/traces/i);
      expect(explanation).toMatch(/analytics/i);
      expect(explanation).toMatch(/scenario runs/i);
      expect(explanation).toMatch(/cannot see costs/i);
    });
  });
});
