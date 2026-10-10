/**
 * @vitest-environment jsdom
 *
 * The prompts page with no prompts invites the reader to create one, except
 * on an aggregate project (ADR-144), which keeps no prompts of its own: there
 * it says data can't be added, as the datasets and automations pages do, and
 * the header offers no New Prompt button.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddPromptButton } from "../../AddPromptButton";
import { NoPromptsOnboardingState } from "../NoPromptsOnboardingState";

const { projectRef } = vi.hoisted(() => ({
  projectRef: { current: { id: "proj-1", kind: "application" } },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: projectRef.current,
    hasPermission: () => true,
  }),
}));

vi.mock("../../../../hooks/useCreateDraftPrompt", () => ({
  useCreateDraftPrompt: () => ({ createDraftPrompt: vi.fn() }),
}));

vi.mock("~/components/SetupWithAgentButton", () => ({
  SetupWithAgentButton: () => null,
}));

const renderInChakra = (node: React.ReactNode) =>
  render(<ChakraProvider value={defaultSystem}>{node}</ChakraProvider>);

afterEach(() => {
  cleanup();
});

describe("NoPromptsOnboardingState", () => {
  describe("given an ordinary project with no prompts", () => {
    describe("when the prompts page opens", () => {
      it("offers to create the first prompt", () => {
        projectRef.current = { id: "proj-1", kind: "application" };

        renderInChakra(<NoPromptsOnboardingState />);

        expect(
          screen.getByRole("button", { name: "Create First Prompt" }),
        ).toBeTruthy();
      });
    });
  });

  describe("given an aggregate project", () => {
    describe("when the prompts page opens", () => {
      /** @scenario "The app marks the aggregate and offers no way to add data to it" */
      it("says data can't be added and offers no way to create a prompt", () => {
        projectRef.current = { id: "agg-1", kind: "aggregate" };

        renderInChakra(
          <>
            <NoPromptsOnboardingState />
            <AddPromptButton />
          </>,
        );

        expect(
          screen.getByText("Data can't be added to this project"),
        ).toBeTruthy();
        expect(
          screen.queryByRole("button", { name: "Create First Prompt" }),
        ).toBeNull();
        expect(screen.queryByText("New Prompt")).toBeNull();
      });
    });
  });
});
