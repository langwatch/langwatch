/**
 * @vitest-environment jsdom
 * An aggregate project (ADR-177) keeps no prompts: no create offer, no New Prompt button.
 * @see specs/governance/aggregate-project.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AddPromptButton } from "../add-prompt-button.tsx";
import { NoPromptsOnboardingState } from "../no-prompts-onboarding-state.tsx";

const { projectRef } = vi.hoisted(() => ({
  projectRef: { current: { id: "proj-1", slug: "web-app", kind: "application" } },
}));

vi.mock("../../../../../behavior/use-prompt-project.ts", () => ({
  usePromptProject: () => ({ project: projectRef.current, hasPermission: () => true }),
}));

vi.mock("../../../../../behavior/use-create-draft-prompt.ts", () => ({
  useCreateDraftPrompt: () => ({ createDraftPrompt: vi.fn() }),
}));

vi.mock("../../../../../model/prompt-host.ts", () => ({
  usePromptHost: () => ({ requestUpgrade: vi.fn() }),
}));

vi.mock("../../../../../behavior/lent-setup-with-agent-button.tsx", () => ({
  SetupWithAgentButton: () => null,
}));

afterEach(() => {
  cleanup();
});

describe("NoPromptsOnboardingState", () => {
  describe("given an ordinary project with no prompts", () => {
    describe("when the prompts page opens", () => {
      it("offers to create the first prompt", () => {
        projectRef.current = { id: "proj-1", slug: "web-app", kind: "application" };

        renderWithDesignSystem(<NoPromptsOnboardingState />);

        expect(screen.getByRole("button", { name: "Create First Prompt" })).toBeTruthy();
      });
    });
  });

  describe("given an aggregate project", () => {
    describe("when the prompts page opens", () => {
      /** @scenario "The app marks the aggregate and offers no way to add data to it" */
      it("says data can't be added and offers no way to create a prompt", () => {
        projectRef.current = { id: "agg-1", slug: "company-view", kind: "aggregate" };

        renderWithDesignSystem(
          <>
            <NoPromptsOnboardingState />
            <AddPromptButton />
          </>,
        );

        expect(screen.getByText("Data can't be added to this project")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Create First Prompt" })).toBeNull();
        expect(screen.queryByText("New Prompt")).toBeNull();
      });
    });
  });
});
