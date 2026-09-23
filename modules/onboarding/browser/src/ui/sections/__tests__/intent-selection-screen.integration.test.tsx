/**
 * @vitest-environment jsdom
 * ADR-038: the intent screen's two cards and their copy are load-bearing —
 * Spec: specs/features/onboarding/intent-fork.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { UiAnalytics, type UiAnalyticsEvent } from "@langwatch/browser-host/analytics";
import { UiCapabilityContextProvider } from "@langwatch/browser-host/capabilities";
import "@testing-library/jest-dom/vitest";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";
import type { OrganizationIntent } from "@langwatch/organization-contract";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OnboardingFormProvider } from "../form-context.tsx";
import { IntentSelectionScreen } from "../intent-selection-screen.tsx";

const noop = () => void 0;

class RecordingUiAnalytics extends UiAnalytics {
  readonly tracked: UiAnalyticsEvent[] = [];

  track(event: UiAnalyticsEvent): void {
    this.tracked.push(event);
  }

  identify(): void {}

  group(): void {}

  reset(): void {}
}

const SURFACE = {
  boundary: "onboarding_welcome.intent",
  attributes: { screenIndex: 1, variant: "cloud" },
};

function renderScreen({
  intent,
  setIntent = vi.fn(),
}: {
  intent?: OrganizationIntent;
  setIntent?: (value: OrganizationIntent | undefined) => void;
} = {}) {
  const contextValue = {
    organizationName: void 0,
    agreement: false,
    intent,
    usageStyle: void 0,
    phoneNumber: void 0,
    companySize: void 0,
    solutionType: void 0,
    selectedDesires: [],
    role: void 0,
    attribution: void 0,
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

  const analytics = new RecordingUiAnalytics();
  const host = { route: () => ({ params: {}, query: {} }), navigate: noop };

  render(
    <ChakraProvider value={defaultSystem}>
      <UiCapabilityContextProvider value={{ ...createUiCapabilitiesFromHost(host), analytics }}>
        <OnboardingFormProvider
          value={contextValue as Parameters<typeof OnboardingFormProvider>[0]["value"]}
        >
          <IntentSelectionScreen surface={SURFACE} />
        </OnboardingFormProvider>
      </UiCapabilityContextProvider>
    </ChakraProvider>,
  );
  return { setIntent, analytics };
}

describe("IntentSelectionScreen", () => {
  describe("given a user reading the intent screen", () => {
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
        expect(screen.getByText("Track AI coding agents")).toBeInTheDocument();
        expect(
          screen.getByText(
            "Usage, spend, and sessions for the AI coding tools your team uses, like Claude Code, Codex, and Cursor",
          ),
        ).toBeInTheDocument();
      });

      /** @scenario "Coding-agent product builders are steered to the LLMOps card" */
      it("pins the LLMOps card copy to claim the agents the user is building", () => {
        renderScreen();
        expect(screen.getByText("Monitor & evaluate my LLM app")).toBeInTheDocument();
        expect(
          screen.getByText("Trace, evaluate, and improve the LLM apps and agents you're building"),
        ).toBeInTheDocument();
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

      it("names the surface it was mounted on, and carries that surface's facts", () => {
        const { analytics } = renderScreen();
        fireEvent.click(screen.getByText("Track AI coding agents"));

        expect(analytics.tracked).toEqual([
          {
            boundary: "onboarding_welcome.intent",
            action: "selected",
            name: "intent",
            attributes: { screenIndex: 1, variant: "cloud", value: "AGENT_GOVERNANCE" },
          },
        ]);
      });
    });
  });

  describe("given an intent is already selected", () => {
    describe("when the screen renders", () => {
      it("marks that card as checked", () => {
        renderScreen({ intent: "AGENT_GOVERNANCE" });
        const [llmOpsCard, governanceCard] = screen.getAllByRole("radio");
        expect(governanceCard?.getAttribute("aria-checked")).toBe("true");
        expect(llmOpsCard?.getAttribute("aria-checked")).toBe("false");
      });
    });
  });
});
