/**
 * @vitest-environment jsdom
 * @see specs/prompts/prompt-studio-page.feature
 */

import "@testing-library/jest-dom/vitest";
import { uiDeclarations, type UiDeclarations } from "@langwatch/browser-host/declarations";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { SetupWithAgentButtonToken } from "@langwatch/trace-contract";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const declarations: { current: UiDeclarations | undefined } = vi.hoisted(() => ({
  current: undefined,
}));

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUiDeclarations: () => declarations.current,
}));

vi.mock("../../../../../behavior/use-create-draft-prompt.ts", () => ({
  useCreateDraftPrompt: () => ({ createDraftPrompt: vi.fn() }),
}));

import { NoPromptsOnboardingState } from "../no-prompts-onboarding-state.tsx";

const traceLends = uiDeclarations([
  {
    name: "trace",
    installation: {
      capabilities: {},
      lends: [
        {
          token: SetupWithAgentButtonToken,
          load: async () => ({
            default: ({ surface }: { surface: string }) => (
              <button>Setup via Agent ({surface})</button>
            ),
          }),
        },
      ],
    },
  },
]);

afterEach(() => {
  cleanup();
  declarations.current = undefined;
});

describe("NoPromptsOnboardingState", () => {
  /** @scenario "A project with no prompts offers to set them up via an agent" */
  it("offers Create First Prompt and trace's Setup via Agent menu for prompts", async () => {
    declarations.current = traceLends;
    renderWithDesignSystem(<NoPromptsOnboardingState />);
    expect(screen.getByRole("button", { name: "Create First Prompt" })).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Setup via Agent (prompts)" }),
    ).toBeInTheDocument();
  });
});
