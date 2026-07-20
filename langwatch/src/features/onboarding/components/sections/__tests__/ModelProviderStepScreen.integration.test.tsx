/**
 * @vitest-environment jsdom
 *
 * The "Set up a model provider" onboarding step renders the REAL provider
 * grid on its onboarding surface (Codex leads with a Recommended badge and
 * the paid-OpenAI-account copy), and both finishing the setup and "Skip for
 * now" advance the flow. The credential form is mocked at its module seam:
 * the grid ordering, the badge, the copy, and the advance wiring are what's
 * under test, not the save mechanics.
 *
 * Spec: specs/features/onboarding/model-provider-step.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ModelProviderStepScreen } from "../ModelProviderStepScreen";

// The setup form drags the tRPC/api tree into jsdom; the step under test
// only cares that it receives the onboarding surface and that its
// onComplete advances the flow, so it is mocked at the module seam with a
// button that fires onComplete.
const lastSetupProps = {
  current: null as null | { variant: string; onComplete?: () => void },
};
vi.mock("../model-provider/ModelProviderSetup", () => ({
  ModelProviderSetup: ({
    variant,
    onComplete,
  }: {
    variant: string;
    onComplete?: () => void;
  }) => {
    lastSetupProps.current = { variant, onComplete };
    return (
      <button type="button" onClick={() => onComplete?.()}>
        finish-provider-setup
      </button>
    );
  },
}));

afterEach(cleanup);

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
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("ModelProviderStepScreen", () => {
  beforeEach(() => {
    lastSetupProps.current = null;
  });

  describe("when the step renders", () => {
    /** @scenario "Codex leads the step with a recommendation" */
    it("offers Codex first, ahead of the registry-first provider", () => {
      renderStep();

      const codexCard = screen.getByRole("button", {
        name: "Codex (OpenAI account)",
      });
      const openAiCard = screen.getByRole("button", { name: "OpenAI" });

      expect(appearsBefore(codexCard, openAiCard)).toBe(true);
    });

    it("marks Codex with the Recommended badge", () => {
      renderStep();
      expect(screen.getByText("Recommended")).toBeInTheDocument();
    });

    it("pins the paid-OpenAI-account recommendation copy", () => {
      renderStep();
      expect(
        screen.getByText(
          /Codex is recommended if you have a paid OpenAI account/,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /The model LangWatch's AI assistant and AI assists run on/,
        ),
      ).toBeInTheDocument();
    });

    it("hands the setup form the onboarding surface", () => {
      renderStep();
      expect(lastSetupProps.current?.variant).toBe("onboarding");
    });
  });

  describe("when the provider setup completes", () => {
    /** @scenario "Completing provider setup advances the flow" */
    it("advances the flow without another click", () => {
      const { onContinue } = renderStep();

      fireEvent.click(
        screen.getByRole("button", { name: "finish-provider-setup" }),
      );

      expect(onContinue).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the user skips the step", () => {
    /** @scenario "Skipping advances without a provider" */
    it("advances the flow from the Skip for now affordance", () => {
      const { onContinue } = renderStep();

      fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

      expect(onContinue).toHaveBeenCalledTimes(1);
    });
  });
});
