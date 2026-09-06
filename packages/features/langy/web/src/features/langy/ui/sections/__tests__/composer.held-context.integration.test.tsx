/**
 * The composer is where held context lives: one context control, showing every
 * chip Langy is holding, in every layout the panel uses.
 * @vitest-environment jsdom
 * Spec: specs/langy/langy-context-attach.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The auto-resizing textarea (Ark's field-textarea) reaches for ResizeObserver
// on mount, which jsdom does not implement.
if (typeof window !== "undefined" && !window.ResizeObserver) {
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
}

vi.mock("../../elements/langy-model-pill", () => ({
  LangyModelPill: () => <div data-testid="model-pill" />,
}));

import { datasetContextChip, traceContextChip } from "../../../../../behavior/langy-context-chips";
import { Composer } from "../composer";

const held = [
  traceContextChip("abc123def456", "checkout flow"),
  datasetContextChip({ datasetId: "ds_12345678", name: "checkout runs" }),
];

function renderComposer(variant: "floating" | "sidebar") {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Composer
        variant={variant}
        model="openai/gpt-5-mini"
        modelOptions={["openai/gpt-5-mini"]}
        onModelChange={() => {}}
        onSend={() => {}}
        onStop={() => {}}
        disabled={false}
        contextChips={held}
      />
    </ChakraProvider>,
  );
}

afterEach(cleanup);

describe("given Langy is holding context", () => {
  describe("when the composer renders in either panel layout", () => {
    /** @scenario The composer is the single home of held context */
    it("shows one context control that accounts for every held chip", () => {
      for (const variant of ["sidebar", "floating"] as const) {
        renderComposer(variant);

        // One control, not one per chip and not a second strip beside it: the
        // dock's old banner restated these chips and is gone.
        const controls = screen.getAllByRole("button", { name: /^Context: \d+ included$/ });
        expect(controls).toHaveLength(1);
        expect(controls[0]).toHaveAccessibleName(`Context: ${held.length} included`);
        // The first chip is named on the face of it; the rest are counted.
        expect(controls[0]).toHaveTextContent("checkout flow");
        expect(controls[0]).toHaveTextContent("+1");

        cleanup();
      }
    });
  });
});
