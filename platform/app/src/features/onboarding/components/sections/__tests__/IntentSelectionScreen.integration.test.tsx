/**
 * @vitest-environment jsdom
 *
 * ADR-038: the intent screen's two cards and their copy are load-bearing —
 * the card text is what keeps a coding-agent-product builder out of the
 * governance track (S1 misroute guard), so it is pinned here.
 *
 * Spec: specs/features/onboarding/intent-fork.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, fireEvent } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";

import { OnboardingFormProvider } from "../../../contexts/form-context";
import { IntentSelectionScreen } from "../IntentSelectionScreen";

const noop = () => void 0;

function renderScreen({
  intent,
  setIntent = vi.fn(),
}: {
  intent?: "AGENT_GOVERNANCE" | "LLM_OPS";
  setIntent?: (value: unknown) => void;
} = {}) {
  const contextValue = {
    organizationName: undefined,
    agreement: false,
    intent,
    usageStyle: undefined,
    phoneNumber: undefined,
    companySize: undefined,
    solutionType: undefined,
    selectedDesires: [],
    role: undefined,
    attribution: undefined,
    setOrganizationName: noop,
    setAgreement: noop,
    setIntent,
    setUsageStyle: noop,
    setPhoneNumber: noop,
    setPhoneHasValue: noop,
    setPhoneIsValid: noop,
    setCompanySize: noop,
    setSolutionType: noop,
    setDesires: noop,
    setRole: noop,
  };

  render(
    <ChakraProvider value={defaultSystem}>
      <OnboardingFormProvider value={contextValue as any}>
        <IntentSelectionScreen />
      </OnboardingFormProvider>
    </ChakraProvider>,
  );
  return { setIntent };
}

describe("IntentSelectionScreen", () => {
  describe("when the screen renders", () => {
    it("shows exactly two intent options", () => {
      renderScreen();
      expect(screen.getAllByRole("radio")).toHaveLength(2);
    });

    it("shows the LLMOps option first", () => {
      renderScreen();
      const [firstCard] = screen.getAllByRole("radio");
      expect(firstCard?.textContent).toContain("Monitor & evaluate my LLM app");
    });

    it("pins the governance card copy to the team's coding-tool usage", () => {
      renderScreen();
      expect(screen.getByText("Track AI coding agents")).toBeDefined();
      expect(
        screen.getByText(
          "Usage, spend, and sessions for the AI coding tools your team uses, like Claude Code, Codex, and Cursor",
        ),
      ).toBeDefined();
    });

    /** @scenario "Coding-agent product builders are steered to the LLMOps card" */
    it("pins the LLMOps card copy to claim the agents the user is building", () => {
      renderScreen();
      expect(screen.getByText("Monitor & evaluate my LLM app")).toBeDefined();
      expect(
        screen.getByText(
          "Trace, evaluate, and improve the LLM apps and agents you're building",
        ),
      ).toBeDefined();
    });
  });

  describe("when the user picks a card", () => {
    it("records the governance intent", () => {
      const { setIntent } = renderScreen();
      fireEvent.click(screen.getByText("Track AI coding agents"));
      expect(setIntent).toHaveBeenCalledWith("AGENT_GOVERNANCE");
    });

    it("records the LLMOps intent", () => {
      const { setIntent } = renderScreen();
      fireEvent.click(screen.getByText("Monitor & evaluate my LLM app"));
      expect(setIntent).toHaveBeenCalledWith("LLM_OPS");
    });
  });

  describe("when an intent is already selected", () => {
    it("marks that card as checked", () => {
      renderScreen({ intent: "AGENT_GOVERNANCE" });
      const [llmOpsCard, governanceCard] = screen.getAllByRole("radio");
      expect(governanceCard?.getAttribute("aria-checked")).toBe("true");
      expect(llmOpsCard?.getAttribute("aria-checked")).toBe("false");
    });
  });
});
