/**
 * @vitest-environment jsdom
 *
 * The Langy composer is one integrated surface: the field, the reused
 * ModelSelector and the send / stop control share a single rounded card,
 * with the model picker and send sitting on the bottom rail. This test pins
 * that structure — the picker is always visible (no collapse-on-hover), and
 * the send control swaps to a stop control while Langy is working.
 *
 * ModelSelector is mocked at its module boundary so the real Chakra Select
 * portal never enters jsdom; we only assert it was handed the composer's
 * model + options.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/components/ModelSelector", () => ({
  ModelSelector: ({ model }: { model: string }) => (
    <div data-testid="model-selector">{model}</div>
  ),
}));
vi.mock("~/features/traces-v2/components/ai/useTypewriterPlaceholder", () => ({
  useTypewriterPlaceholder: () => "Ask Langy…",
}));

import { Composer } from "../components/Composer";

function renderComposer(overrides: Partial<{ isBusy: boolean }> = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Composer
        input=""
        onInputChange={() => {}}
        model="openai/gpt-5-mini"
        modelOptions={["openai/gpt-5-mini"]}
        onModelChange={() => {}}
        onSend={() => {}}
        onStop={() => {}}
        isBusy={overrides.isBusy ?? false}
        disabled={false}
        canSend={false}
      />
    </ChakraProvider>,
  );
}

afterEach(cleanup);

describe("given the integrated Langy composer", () => {
  describe("when idle", () => {
    it("renders the reused model picker and a send control on the bottom rail", () => {
      renderComposer();

      const picker = screen.getByTestId("langy-model-picker");
      expect(picker.getAttribute("data-model")).toBe("openai/gpt-5-mini");
      expect(screen.getByTestId("model-selector").textContent).toBe(
        "openai/gpt-5-mini",
      );
      expect(screen.getByLabelText("Send")).toBeTruthy();
    });
  });

  describe("when Langy is working", () => {
    it("swaps the send control for a stop control", () => {
      renderComposer({ isBusy: true });

      expect(screen.getByLabelText("Stop")).toBeTruthy();
      expect(screen.queryByLabelText("Send")).toBeNull();
    });
  });
});
