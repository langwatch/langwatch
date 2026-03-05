/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptConfigFormValues } from "~/prompts";
import { PromptEditorHeader } from "../PromptEditorHeader";

// Mock child components to isolate the header's rendering logic
vi.mock("~/prompts/forms/fields/ModelSelectFieldMini", () => ({
  ModelSelectFieldMini: () => (
    <div data-testid="model-select-field-mini">ModelSelectFieldMini</div>
  ),
}));

vi.mock(
  "~/prompts/forms/prompt-config-form/components/VersionHistoryButton",
  () => ({
    VersionHistoryButton: () => (
      <button data-testid="version-history-button">History</button>
    ),
  }),
);

vi.mock("~/prompts/components/GeneratePromptApiSnippetDialog", () => {
  const Dialog = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="api-snippet-dialog">{children}</div>
  );
  Dialog.Trigger = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="api-snippet-trigger">{children}</div>
  );
  return { GeneratePromptApiSnippetDialog: Dialog };
});

vi.mock("~/components/GenerateApiSnippetButton", () => ({
  GenerateApiSnippetButton: () => (
    <button data-testid="api-snippet-button">API</button>
  ),
}));

vi.mock("~/prompts/components/SavePromptButton", () => ({
  SavePromptButton: () => (
    <button data-testid="save-prompt-button">Save</button>
  ),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", apiKey: "test-api-key" },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

function TestWrapper({
  children,
  formValues,
}: {
  children: React.ReactNode;
  formValues?: Partial<PromptConfigFormValues>;
}) {
  const methods = useForm<PromptConfigFormValues>({
    defaultValues: {
      configId: "test-config",
      handle: "test-handle",
      versionMetadata: {
        versionId: "test-version",
        versionNumber: 1,
        versionCreatedAt: new Date(),
      },
      ...formValues,
    } as PromptConfigFormValues,
  });

  return (
    <ChakraProvider value={defaultSystem}>
      <FormProvider {...methods}>{children}</FormProvider>
    </ChakraProvider>
  );
}

describe("<PromptEditorHeader/>", () => {
  const defaultProps = {
    onSave: vi.fn(),
    hasUnsavedChanges: false,
    onVersionRestore: vi.fn(),
  };

  describe("when variant is 'full' (default)", () => {
    it("renders the model selector", () => {
      render(
        <TestWrapper>
          <PromptEditorHeader {...defaultProps} />
        </TestWrapper>,
      );

      expect(screen.getByTestId("model-select-field-mini")).toBeInTheDocument();
    });

    it("renders the version history button", () => {
      render(
        <TestWrapper>
          <PromptEditorHeader {...defaultProps} />
        </TestWrapper>,
      );

      expect(screen.getByTestId("version-history-button")).toBeInTheDocument();
    });

    it("renders the API snippet button", () => {
      render(
        <TestWrapper>
          <PromptEditorHeader {...defaultProps} />
        </TestWrapper>,
      );

      expect(screen.getByTestId("api-snippet-button")).toBeInTheDocument();
    });

    it("renders the save button", () => {
      render(
        <TestWrapper>
          <PromptEditorHeader {...defaultProps} />
        </TestWrapper>,
      );

      expect(screen.getByTestId("save-prompt-button")).toBeInTheDocument();
    });
  });

  describe("when variant is 'model-only'", () => {
    it("renders the model selector", () => {
      render(
        <TestWrapper>
          <PromptEditorHeader {...defaultProps} variant="model-only" />
        </TestWrapper>,
      );

      expect(screen.getByTestId("model-select-field-mini")).toBeInTheDocument();
    });

    it("does not render the version history button", () => {
      render(
        <TestWrapper>
          <PromptEditorHeader {...defaultProps} variant="model-only" />
        </TestWrapper>,
      );

      expect(
        screen.queryByTestId("version-history-button"),
      ).not.toBeInTheDocument();
    });

    it("does not render the API snippet button", () => {
      render(
        <TestWrapper>
          <PromptEditorHeader {...defaultProps} variant="model-only" />
        </TestWrapper>,
      );

      expect(
        screen.queryByTestId("api-snippet-button"),
      ).not.toBeInTheDocument();
    });

    it("does not render the save button", () => {
      render(
        <TestWrapper>
          <PromptEditorHeader {...defaultProps} variant="model-only" />
        </TestWrapper>,
      );

      expect(
        screen.queryByTestId("save-prompt-button"),
      ).not.toBeInTheDocument();
    });
  });
});
