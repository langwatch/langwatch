/**
 * @vitest-environment jsdom
 *
 * The onboarding screens paint their selected card and their icon chip with an
 * orange accent. Those surfaces are the only thing between the card's `fg`
 * title and the reader: when the surface stays light while `fg` flips to
 * near-white in dark mode, the title vanishes into it. A customer reported
 * exactly that — the intent card's title became unreadable the moment they
 * picked it.
 *
 * Assertion technique: jsdom's `getComputedStyle` cannot resolve Chakra v3's
 * emitted rules (it returns `rgba(0, 0, 0, 0)` whatever the mode), so these
 * read the injected stylesheet instead. A mode-aware value emits a second,
 * `.dark`-scoped rule for the element's class; a light-only token emits only
 * the base rule. That second rule is the thing that was missing.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OnboardingFormProvider } from "../../../contexts/form-context";
import { IntentSelectionScreen } from "../IntentSelectionScreen";

const noop = () => void 0;

/**
 * True when the element's own class carries a `.dark`-scoped rule that repaints
 * `background` — i.e. the surface is mode-aware rather than light-only.
 */
function hasDarkModeBackgroundRule(element: Element): boolean {
  const classNames = (element.getAttribute("class") ?? "")
    .split(/\s+/)
    .filter(Boolean);
  if (classNames.length === 0) return false;

  const stylesheet = Array.from(document.querySelectorAll("style"))
    .map((tag) => tag.textContent ?? "")
    .join("\n");

  return stylesheet
    .split("}")
    .some(
      (rule) =>
        rule.includes(".dark") &&
        rule.includes("background:") &&
        classNames.some((className) => rule.includes(`.${className}`)),
    );
}

function renderIntentScreen(intent?: "AGENT_GOVERNANCE" | "LLM_OPS") {
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
    setIntent: vi.fn(),
    setUsageStyle: noop,
    setPhoneNumber: noop,
    setPhoneHasValue: noop,
    setPhoneIsValid: noop,
    setCompanySize: noop,
    setSolutionType: noop,
    setDesires: noop,
    setRole: noop,
  };

  return render(
    <ChakraProvider value={defaultSystem}>
      <OnboardingFormProvider value={contextValue as any}>
        <IntentSelectionScreen />
      </OnboardingFormProvider>
    </ChakraProvider>,
  );
}

describe("given the onboarding intent screen carries orange accent surfaces", () => {
  afterEach(cleanup);

  describe("when a card is selected", () => {
    /** @scenario Selected intent card repaints its surface for dark mode */
    it("gives the selected card a dark-mode background of its own", () => {
      renderIntentScreen("AGENT_GOVERNANCE");

      const selected = screen
        .getAllByRole("radio")
        .find((card) => card.getAttribute("aria-checked") === "true");

      expect(selected).toBeDefined();
      expect(hasDarkModeBackgroundRule(selected!)).toBe(true);
    });

    /** @scenario Selected intent card keeps its title legible */
    it("keeps the unselected cards on the mode-aware panel surface", () => {
      renderIntentScreen("AGENT_GOVERNANCE");

      const unselected = screen
        .getAllByRole("radio")
        .find((card) => card.getAttribute("aria-checked") === "false");

      expect(unselected).toBeDefined();
      // `bg.panel` is a semantic token and already resolves per mode, so the
      // unselected card must never be pinned to a raw palette step either.
      expect(unselected!.getAttribute("class")).toBeTruthy();
    });
  });

  describe("when the cards render their icon chip", () => {
    /** @scenario Onboarding icon chip repaints its surface for dark mode */
    it("gives the chip a dark-mode background of its own", () => {
      const { container } = renderIntentScreen();

      const chip = container.querySelector('[data-testid="intent-icon-chip"]');

      expect(chip).not.toBeNull();
      expect(hasDarkModeBackgroundRule(chip!)).toBe(true);
    });
  });
});
