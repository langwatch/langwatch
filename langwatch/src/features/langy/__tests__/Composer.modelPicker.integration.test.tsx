/**
 * @vitest-environment jsdom
 *
 * The Langy composer is one integrated surface: the field with send / stop
 * beside it, and the reused ModelSelector on the rail below, all inside a
 * single rounded card. This test pins that structure — the picker is always
 * visible (no collapse-on-hover), and the send control swaps to a stop control
 * while Langy is working.
 *
 * "Working" comes from the store's turn phase (ADR-058), the composer's single
 * source for the send/stop affordance — there is no `isBusy` prop.
 *
 * The shared model-option hook is mocked at its module boundary so the test
 * stays about the composer's rail, not the project-provider query.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/components/ModelSelector", () => ({
  ModelSelector: ({ model }: { model: string }) => (
    <div data-testid="model-selector">{model}</div>
  ),
  useModelSelectionOptions: (options: string[], model: string) => ({
    selectOptions: options.map((value) => ({
      value,
      label: value.split("/").slice(1).join("/"),
      isCustom: false,
    })),
    modelOption: options.includes(model)
      ? {
          value: model,
          label: model.split("/").slice(1).join("/"),
          isCustom: false,
        }
      : undefined,
  }),
}));
vi.mock("~/features/traces-v2/components/ai/useTypewriterPlaceholder", () => ({
  useTypewriterPlaceholder: () => "Ask Langy…",
}));

import { Composer } from "../components/Composer";
import { useLangyStore } from "../stores/langyStore";

function renderComposer(
  overrides: Partial<{ model: string; modelOptions: string[] }> = {},
) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Composer
        model={overrides.model ?? "openai/gpt-5-mini"}
        modelOptions={overrides.modelOptions ?? ["openai/gpt-5-mini"]}
        onModelChange={() => {}}
        onSend={() => {}}
        onStop={() => {}}
        disabled={false}
      />
    </ChakraProvider>,
  );
}

const resetPhase = () =>
  useLangyStore.setState({ turnPhase: "idle", draft: "" });

beforeEach(resetPhase);
afterEach(() => {
  cleanup();
  resetPhase();
});

describe("given the integrated Langy composer", () => {
  describe("when idle", () => {
    it("renders the reused model picker and a send control on the bottom rail", () => {
      renderComposer();

      const picker = screen.getByTestId("langy-model-picker");
      expect(picker.getAttribute("data-model")).toBe("openai/gpt-5-mini");
      expect(picker.getAttribute("aria-label")).toBe("Model: gpt-5-mini");
      expect(screen.getByLabelText("Send")).toBeTruthy();
    });
  });

  describe("when Langy is working", () => {
    it("swaps the send control for a stop control", () => {
      useLangyStore.setState({ turnPhase: "active" });
      renderComposer();

      expect(screen.getByLabelText("Stop")).toBeTruthy();
      expect(screen.queryByLabelText("Send")).toBeNull();
    });
  });

  describe("when model options have not arrived", () => {
    it("keeps a visible loading label and a real placeholder icon", () => {
      renderComposer({ model: "", modelOptions: [] });

      const picker = screen.getByTestId("langy-model-picker");
      expect(picker.getAttribute("data-loading")).toBe("true");
      expect(picker.getAttribute("aria-label")).toBe(
        "Model: Models are still loading…",
      );
    });
  });
});
