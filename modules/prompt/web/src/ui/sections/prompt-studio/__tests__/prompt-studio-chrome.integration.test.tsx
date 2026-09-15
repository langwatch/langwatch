/**
 * @vitest-environment jsdom
 *
 * What the playground's chrome says: the editor header's one primary action,
 * the prompt editor's section title, and the workspace toolbar's offer to
 * start a new prompt.
 *
 * @see specs/prompts/playground-surface-hierarchy.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { PromptConfigFormValues } from "@langwatch/prompt-contract";
import type { ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddPromptButton } from "../sidebar/add-prompt-button.tsx";
import { EditingModeTitle } from "../fields/editing-mode-title.tsx";
import { SavePromptButton } from "../save-prompt-button.tsx";

const latestVersion = vi.hoisted(() => vi.fn());

vi.mock("../../../../behavior/use-latest-prompt-version.ts", () => ({
  useLatestPromptVersion: (...args: unknown[]) => latestVersion(...args),
}));
vi.mock("../../../../behavior/use-prompt-project.ts", () => ({
  usePromptProject: () => ({
    project: { id: "proj_1" },
    hasPermission: () => true,
  }),
}));
vi.mock("../../../../behavior/use-create-draft-prompt.ts", () => ({
  useCreateDraftPrompt: () => ({ createDraftPrompt: vi.fn() }),
}));
vi.mock("../../../../model/prompt-host.ts", () => ({
  usePromptHost: () => ({ requestUpgrade: vi.fn() }),
}));

function Wrapper({
  children,
  values,
}: {
  children: ReactNode;
  values: Partial<PromptConfigFormValues>;
}) {
  const Inner = () => {
    const form = useForm<PromptConfigFormValues>({
      defaultValues: values as PromptConfigFormValues,
    });
    return <FormProvider {...form}>{children}</FormProvider>;
  };
  return (
    <ChakraProvider value={defaultSystem}>
      <Inner />
    </ChakraProvider>
  );
}

function renderSaveButton({
  values,
  hasUnsavedChanges,
}: {
  values: Partial<PromptConfigFormValues>;
  hasUnsavedChanges: boolean;
}) {
  return render(
    <Wrapper values={values}>
      <SavePromptButton onSave={() => undefined} hasUnsavedChanges={hasUnsavedChanges} />
    </Wrapper>,
  );
}

afterEach(() => cleanup());

describe("the playground's chrome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a saved prompt with unsaved edits", () => {
    /** @scenario The primary action names the version a save will produce */
    it("names the version the save will produce", () => {
      latestVersion.mockReturnValue({
        currentVersion: 2,
        latestVersion: 2,
        isOutdated: false,
        isLoading: false,
        nextVersion: 3,
      });

      renderSaveButton({
        values: { configId: "config_1", versionMetadata: { versionNumber: 2 } } as never,
        hasUnsavedChanges: true,
      });

      expect(screen.getByTestId("save-prompt-button")).toHaveTextContent("Update to v3");
    });
  });

  describe("given a prompt at its latest version with no edits", () => {
    /** @scenario The primary action is quiet when there is nothing to save */
    it("reads Saved and offers nothing to press", () => {
      latestVersion.mockReturnValue({
        currentVersion: 2,
        latestVersion: 2,
        isOutdated: false,
        isLoading: false,
        nextVersion: 3,
      });

      renderSaveButton({
        values: { configId: "config_1", versionMetadata: { versionNumber: 2 } } as never,
        hasUnsavedChanges: false,
      });

      const button = screen.getByTestId("save-prompt-button");
      expect(button).toHaveTextContent("Saved");
      expect(button).toBeDisabled();
    });
  });

  describe("given a prompt that was never saved", () => {
    /** @scenario A prompt that was never saved offers a plain save */
    it("offers a plain Save", () => {
      latestVersion.mockReturnValue({
        currentVersion: undefined,
        latestVersion: undefined,
        isOutdated: false,
        isLoading: false,
        nextVersion: undefined,
      });

      renderSaveButton({ values: {}, hasUnsavedChanges: true });

      expect(screen.getByTestId("save-prompt-button")).toHaveTextContent("Save");
    });
  });

  describe("given the prompt editor's section title", () => {
    /** @scenario The prompt section is titled for the mode it is in */
    it("titles the section for the mode it is in", () => {
      const { rerender } = render(
        <ChakraProvider value={defaultSystem}>
          <EditingModeTitle mode="prompt" onChange={() => undefined} />
        </ChakraProvider>,
      );

      expect(screen.getByText("Prompt")).toBeInTheDocument();

      rerender(
        <ChakraProvider value={defaultSystem}>
          <EditingModeTitle mode="messages" onChange={() => undefined} />
        </ChakraProvider>,
      );

      expect(screen.getByText("Messages")).toBeInTheDocument();
    });
  });

  describe("given the workspace toolbar", () => {
    /** @scenario Starting a new prompt is offered from the workspace toolbar */
    it("offers to start a new prompt, in words", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <AddPromptButton />
        </ChakraProvider>,
      );

      expect(screen.getByRole("button", { name: /New Prompt/ })).toBeInTheDocument();
    });
  });
});
