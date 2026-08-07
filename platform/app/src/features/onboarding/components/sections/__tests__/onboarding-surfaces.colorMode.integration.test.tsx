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
 *
 * These tests carry no spec-binding annotation on purpose — this is a bug fix,
 * and the repo does not open feature files for bug fixes.
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
/** Every emitted CSS rule that targets one of the element's own classes. */
function rulesFor(element: Element): string[] {
  const classNames = (element.getAttribute("class") ?? "")
    .split(/\s+/)
    .filter(Boolean);
  if (classNames.length === 0) return [];

  return Array.from(document.querySelectorAll("style"))
    .map((tag) => tag.textContent ?? "")
    .join("\n")
    .split("}")
    .filter((rule) =>
      classNames.some((className) => rule.includes(`.${className}`)),
    );
}

/** The element's base (mode-independent) `background` declaration. */
function backgroundDeclarationFor(element: Element): string {
  const base = rulesFor(element).find(
    (rule) => !rule.includes(".dark") && rule.includes("background:"),
  );
  return base ?? "";
}

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
    it("gives the selected card a dark-mode background of its own", () => {
      renderIntentScreen("AGENT_GOVERNANCE");

      const selected = screen
        .getAllByRole("radio")
        .find((card) => card.getAttribute("aria-checked") === "true");

      expect(selected).toBeDefined();
      expect(hasDarkModeBackgroundRule(selected!)).toBe(true);
    });

    it("keeps the unselected cards on a semantic surface token", () => {
      renderIntentScreen("AGENT_GOVERNANCE");

      const unselected = screen
        .getAllByRole("radio")
        .find((card) => card.getAttribute("aria-checked") === "false");

      expect(unselected).toBeDefined();
      // The unselected card is mode-aware by a different route: `bg.panel` is
      // a semantic token, so it emits ONE rule pointing at a variable whose
      // value flips at `:root`, with no `.dark` rule of its own. Assert the
      // variable it reaches for — a raw palette step would name the palette.
      const background = backgroundDeclarationFor(unselected!);
      expect(background).toContain("--chakra-colors-bg");
      expect(background).not.toMatch(/--chakra-colors-(orange|gray|zinc)-\d/);
    });
  });

  describe("when the cards render their icon chip", () => {
    it("gives the chip a dark-mode background of its own", () => {
      const { container } = renderIntentScreen();

      const chip = container.querySelector('[data-testid="intent-icon-chip"]');

      expect(chip).not.toBeNull();
      expect(hasDarkModeBackgroundRule(chip!)).toBe(true);
    });
  });
});
