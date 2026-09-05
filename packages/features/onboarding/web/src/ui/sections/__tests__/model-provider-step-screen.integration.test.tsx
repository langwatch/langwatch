/**
 * @vitest-environment jsdom
 * Spec: specs/features/onboarding/model-provider-step.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("react-contextual-analytics", () => ({
  useAnalytics: () => ({ emit: vi.fn() }),
}));

const configured = vi.hoisted(() => ({
  current: null as null | { provider: string; defaultModel: string },
}));

vi.mock("../model-provider/model-provider-setup", () => ({
  ModelProviderSetup: ({
    providerKey,
    onComplete,
  }: {
    providerKey: string;
    onComplete: () => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        configured.current = { provider: providerKey, defaultModel: "openai/gpt-5-mini" };
        onComplete();
      }}
    >
      finish-provider-setup
    </button>
  ),
}));

import { ModelProviderStepScreen } from "../model-provider-step-screen";

function renderStep() {
  const onContinue = vi.fn();
  render(
    <ChakraProvider value={defaultSystem}>
      <ModelProviderStepScreen onContinue={onContinue} />
    </ChakraProvider>,
  );
  return { onContinue };
}

/** True when `first` appears strictly before `second` in document order. */
function appearsBefore(first: HTMLElement, second: HTMLElement): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("ModelProviderStepScreen", () => {
  beforeEach(() => {
    configured.current = null;
  });

  describe("when the step renders", () => {
    /** @scenario "Codex leads the step with a recommendation" */
    it("offers Codex first, ahead of the registry-first provider", () => {
      renderStep();

      // The badge folds into the accessible name, so match on the label prefix.
      const codexCard = screen.getByRole("button", { name: /^Codex \(OpenAI account\)/ });
      const openAiCard = screen.getByRole("button", { name: "OpenAI" });

      expect(appearsBefore(codexCard, openAiCard)).toBe(true);
    });

    it("marks Codex with the Recommended badge", () => {
      renderStep();

      expect(screen.getByText("Recommended")).toBeInTheDocument();
    });

    it("keeps the step description to one line", () => {
      renderStep();

      expect(
        screen.getByText(/The model LangWatch's AI assistant and AI assists run on/),
      ).toBeInTheDocument();
    });

    it("hands the setup form the leading provider", () => {
      const { onContinue } = renderStep();

      fireEvent.click(screen.getByRole("button", { name: "finish-provider-setup" }));

      expect(configured.current?.provider).toBe("openai_codex");
      expect(onContinue).toHaveBeenCalled();
    });
  });

  describe("when the provider setup completes", () => {
    /** @scenario "Completing provider setup advances the flow" */
    it("advances the flow without another click", () => {
      const { onContinue } = renderStep();

      fireEvent.click(screen.getByRole("button", { name: "finish-provider-setup" }));

      expect(onContinue).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the user skips the step", () => {
    /** @scenario "Skipping advances without a provider" */
    it("advances the flow and configures no provider", () => {
      const { onContinue } = renderStep();

      fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

      expect(onContinue).toHaveBeenCalledTimes(1);
      expect(configured.current).toBeNull();
    });
  });
});
