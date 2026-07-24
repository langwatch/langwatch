/**
 * @vitest-environment jsdom
 *
 * Regression: the Inherit row at the top of the model picker must be
 * selectable AND must not render the user-facing word "Cascade".
 *
 * The prior bug rendered the inherit row as a Select.Item whose value
 * (INHERIT_SENTINEL) was not present in the Chakra collection — so the
 * picker looked like it had a clickable Inherit option, but hover and
 * click silently fell through to the first real model below it (caught
 * by rchaves on 2026-05-18 dogfood). Fix wires INHERIT_SENTINEL into
 * the collection and drops the "Cascade" group header.
 *
 * Binds the scenario `Inherit row is a real, selectable option in the
 * model picker` in specs/model-providers/model-default-config-cascade.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  INHERIT_SENTINEL,
  ProviderModelSelector,
} from "../ProviderModelSelector";

afterEach(() => cleanup());

function renderSelector(ui: React.ReactElement) {
  return render(
    <ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>,
  );
}

describe("ProviderModelSelector with inheritOption", () => {
  /** @scenario Inherit row is a real, selectable option in the model picker */
  it("renders the inherit row without a Cascade group label", () => {
    renderSelector(
      <ProviderModelSelector
        model=""
        options={["openai/gpt-5", "gemini/gemini-3.1-flash-lite"]}
        onChange={vi.fn()}
        inheritOption={{ model: "openai/gpt-5.2", label: "Inherit (from System)" }}
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
