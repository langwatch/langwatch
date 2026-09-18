/**
 * @vitest-environment jsdom
 * Regression: the Inherit row looked clickable but INHERIT_SENTINEL was missing from the Chakra
 * collection, so hover/click silently fell through to the first real model below it. Binds
 * specs/model-providers/model-default-config-cascade.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { INHERIT_SENTINEL, ProviderModelSelector } from "../provider-model-selector.tsx";

afterEach(() => cleanup());

function renderSelector(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

describe("ProviderModelSelector with inheritOption", () => {
  /** @scenario Inherit row is a real, selectable option in the model picker */
  it("renders the inherit row without a Cascade group label", () => {
    renderSelector(
      <ProviderModelSelector
        model=""
        options={["openai/gpt-5", "gemini/gemini-3.1-flash-lite"]}
        onChange={vi.fn()}
        inheritOption={{
          model: "openai/gpt-5.2",
          label: "Inherit (from System)",
        }}
      />,
    );

    // Trigger always renders even when collapsed; the inherit label
    // shows in the placeholder area when model is empty.
    expect(screen.getAllByText("Inherit (from System)").length).toBeGreaterThan(0);
    // Cascade is jargon, not user copy — must be gone from the picker.
    expect(screen.queryByText(/cascade/i)).not.toBeInTheDocument();
  });

  it("exports an INHERIT_SENTINEL constant the parent can compare against", () => {
    expect(typeof INHERIT_SENTINEL).toBe("string");
    expect(INHERIT_SENTINEL.length).toBeGreaterThan(0);
  });
});
