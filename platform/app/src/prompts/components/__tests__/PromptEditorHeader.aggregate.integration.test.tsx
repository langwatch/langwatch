/**
 * @vitest-environment jsdom
 *
 * An aggregate project (ADR-144) keeps no prompts of its own and refuses
 * every write. A playground tab carried over from another project still
 * renders its editor header there, and it must offer neither Save nor
 * Deploy; an ordinary project keeps both.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PromptConfigFormValues } from "~/prompts";
import { PromptEditorHeader } from "../PromptEditorHeader";

const { projectRef } = vi.hoisted(() => ({
  projectRef: {
    current: { id: "proj-1", apiKey: "key", kind: "application" },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: projectRef.current }),
}));

vi.mock("~/prompts/forms/fields/ModelSelectFieldMini", () => ({
  ModelSelectFieldMini: () => null,
}));

vi.mock(
  "~/prompts/forms/prompt-config-form/components/VersionHistoryButton",
  () => ({ VersionHistoryButton: () => null }),
);

vi.mock("~/prompts/components/DeployPromptDialog", () => ({
  DeployPromptDialog: () => null,
}));

// The save button reads the prompt's latest version from the server.
vi.mock("~/prompts/hooks/useLatestPromptVersion", () => ({
  useLatestPromptVersion: () => ({ nextVersion: undefined, latestVersion: 1 }),
}));

function Header() {
  const methods = useForm<PromptConfigFormValues>({
    defaultValues: {
      configId: "config-1",
      handle: "support-bot",
      versionMetadata: {
        versionId: "version-1",
        versionNumber: 1,
        versionCreatedAt: new Date(),
      },
    } as PromptConfigFormValues,
  });
  return (
    <ChakraProvider value={defaultSystem}>
      <FormProvider {...methods}>
        <PromptEditorHeader onSave={vi.fn()} hasUnsavedChanges />
      </FormProvider>
    </ChakraProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe("<PromptEditorHeader/>", () => {
  describe("given an ordinary project", () => {
    it("offers Save and Deploy", () => {
      projectRef.current = { id: "proj-1", apiKey: "key", kind: "application" };

      render(<Header />);

      expect(screen.getByTestId("save-prompt-button")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Deploy" })).toBeTruthy();
    });
  });

  describe("given an aggregate project with a playground tab carried over", () => {
    /** @scenario "The app marks the aggregate and offers no way to add data to it" */
    it("offers neither Save nor Deploy", () => {
      projectRef.current = { id: "agg-1", apiKey: "key", kind: "aggregate" };

      render(<Header />);

      expect(screen.queryByTestId("save-prompt-button")).toBeNull();
      expect(screen.queryByRole("button", { name: "Deploy" })).toBeNull();
    });
  });
});
