/**
 * @vitest-environment jsdom
 *
 * Skill ordering for the shared onboarding skill list. The traces empty
 * state promotes "Add LangWatch tracing to your code" to the front via
 * `primarySkillId`; every other surface keeps the default order.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { PromptList, SkillList, TRACING_SKILL_ID } from "./ViaClaudeCodeScreen";

const TRACING_LABEL = "Add LangWatch tracing to your code";
// The default-first skill in the shared list — used as the ordering anchor.
const DEFAULT_FIRST_LABEL = "Set up evaluations for your agent";

afterEach(cleanup);

function renderWithChakra(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

/** True when `first` appears strictly before `second` in document order. */
function appearsBefore(first: HTMLElement, second: HTMLElement): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("SkillList", () => {
  describe("given the traces onboarding passes primarySkillId 'tracing'", () => {
    it("renders the tracing skill ahead of the default-first skill", () => {
      renderWithChakra(<SkillList primarySkillId={TRACING_SKILL_ID} />);

      const tracing = screen.getByText(TRACING_LABEL);
      const defaultFirst = screen.getByText(DEFAULT_FIRST_LABEL);

      expect(appearsBefore(tracing, defaultFirst)).toBe(true);
    });
  });

  describe("given no primarySkillId (the shared onboarding flow)", () => {
    it("keeps the default order with evaluations ahead of tracing", () => {
      renderWithChakra(<SkillList />);

      const tracing = screen.getByText(TRACING_LABEL);
      const defaultFirst = screen.getByText(DEFAULT_FIRST_LABEL);

      expect(appearsBefore(defaultFirst, tracing)).toBe(true);
    });
  });
});

describe("PromptList", () => {
  describe("given the traces onboarding passes primarySkillId 'tracing'", () => {
    it("renders the tracing prompt ahead of the default-first prompt", () => {
      renderWithChakra(<PromptList primarySkillId={TRACING_SKILL_ID} />);

      const tracing = screen.getByText(TRACING_LABEL);
      const defaultFirst = screen.getByText(DEFAULT_FIRST_LABEL);

      expect(appearsBefore(tracing, defaultFirst)).toBe(true);
    });
  });

  describe("given no primarySkillId (the shared onboarding flow)", () => {
    it("keeps the default order with evaluations ahead of tracing", () => {
      renderWithChakra(<PromptList />);

      const tracing = screen.getByText(TRACING_LABEL);
      const defaultFirst = screen.getByText(DEFAULT_FIRST_LABEL);

      expect(appearsBefore(defaultFirst, tracing)).toBe(true);
    });
  });
});
