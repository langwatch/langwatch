/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptConfigFormValues } from "~/prompts";
import { PromptEditorFooter } from "../PromptEditorFooter";

// Mock child components to isolate the footer's rendering logic
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
  SavePromptButton: ({ onSave }: { onSave: () => void }) => (
    <button data-testid="save-prompt-button" onClick={onSave}>
      Save
    </button>
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

describe("<PromptEditorFooter/>", () => {
  const defaultProps = {
    onSave: vi.fn(),
    hasUnsavedChanges: false,
  };

  describe("when rendered with default props", () => {
    it("renders the history button", () => {
      render(
        <TestWrapper>
          <PromptEditorFooter
            {...defaultProps}
            configId="test-config"
            onVersionRestore={vi.fn()}
          />
        </TestWrapper>,
      );

      expect(screen.getByTestId("version-history-button")).toBeInTheDocument();
    });

    it("renders the API snippet button", () => {
      render(
        <TestWrapper>
          <PromptEditorFooter {...defaultProps} />
        </TestWrapper>,
      );

      expect(screen.getByTestId("api-snippet-button")).toBeInTheDocument();
    });

    it("renders the save button", () => {
      render(
        <TestWrapper>
          <PromptEditorFooter {...defaultProps} />
        </TestWrapper>,
      );

      expect(screen.getByTestId("save-prompt-button")).toBeInTheDocument();
    });
  });

  describe("when onApply is provided", () => {
    it("renders the Apply button", () => {
      render(
        <TestWrapper>
          <PromptEditorFooter {...defaultProps} onApply={vi.fn()} />
        </TestWrapper>,
      );

      expect(
        screen.getByRole("button", { name: "Apply" }),
      ).toBeInTheDocument();
    });
  });

  describe("when onApply is not provided", () => {
    it("does not render the Apply button", () => {
      render(
        <TestWrapper>
          <PromptEditorFooter {...defaultProps} />
        </TestWrapper>,
      );

      expect(
        screen.queryByRole("button", { name: "Apply" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when onDiscard is provided", () => {
    it("renders the Discard button", () => {
      render(
        <TestWrapper>
          <PromptEditorFooter {...defaultProps} onDiscard={vi.fn()} />
        </TestWrapper>,
      );

      expect(
        screen.getByRole("button", { name: "Discard" }),
      ).toBeInTheDocument();
    });
  });

  describe("when onDiscard is not provided", () => {
    it("does not render the Discard button", () => {
      render(
        <TestWrapper>
          <PromptEditorFooter {...defaultProps} />
        </TestWrapper>,
      );

      expect(
        screen.queryByRole("button", { name: "Discard" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when Save button is clicked", () => {
    it("calls onSave", () => {
      const onSave = vi.fn();
      render(
        <TestWrapper>
          <PromptEditorFooter {...defaultProps} onSave={onSave} />
        </TestWrapper>,
      );

      fireEvent.click(screen.getByTestId("save-prompt-button"));
      expect(onSave).toHaveBeenCalledOnce();
    });
  });

  describe("when Apply button is clicked", () => {
    it("calls onApply", () => {
      const onApply = vi.fn();
      render(
        <TestWrapper>
          <PromptEditorFooter {...defaultProps} onApply={onApply} />
        </TestWrapper>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
      expect(onApply).toHaveBeenCalledOnce();
    });
  });

  describe("when Discard button is clicked", () => {
    it("calls onDiscard", () => {
      const onDiscard = vi.fn();
      render(
        <TestWrapper>
          <PromptEditorFooter {...defaultProps} onDiscard={onDiscard} />
        </TestWrapper>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Discard" }));
      expect(onDiscard).toHaveBeenCalledOnce();
    });
  });
});
