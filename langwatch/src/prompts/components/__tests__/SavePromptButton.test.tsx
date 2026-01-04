/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptConfigFormValues } from "~/prompts";
import { SavePromptButton } from "../SavePromptButton";

// Mock useLatestPromptVersion hook
vi.mock("~/prompts/hooks/useLatestPromptVersion", () => ({
  useLatestPromptVersion: vi.fn(),
}));

// Import the mocked module
import { useLatestPromptVersion } from "~/prompts/hooks/useLatestPromptVersion";

const mockUseLatestPromptVersion = vi.mocked(useLatestPromptVersion);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// Wrapper that provides form context
function TestWrapper({
  children,
  formValues,
}: {
  children: React.ReactNode;
  formValues: Partial<PromptConfigFormValues>;
}) {
  const methods = useForm<PromptConfigFormValues>({
    defaultValues: {
      configId: "test-config",
      versionMetadata: {
        versionId: "test-version",
        versionNumber: 5,
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

describe("SavePromptButton", () => {
  describe("when at latest version with no changes", () => {
    it("shows 'Saved' and is disabled", () => {
      mockUseLatestPromptVersion.mockReturnValue({
        currentVersion: 5,
        latestVersion: 5,
        nextVersion: 6,
        isOutdated: false,
        isLoading: false,
      });

      render(
        <TestWrapper formValues={{ versionMetadata: { versionNumber: 5, versionId: "v5", versionCreatedAt: new Date() } }}>
          <SavePromptButton onSave={vi.fn()} hasUnsavedChanges={false} />
        </TestWrapper>
      );

      const button = screen.getByTestId("save-prompt-button");
      expect(button).toHaveTextContent("Saved");
      expect(button).toBeDisabled();
    });
  });

  describe("when at latest version with changes", () => {
    it("shows 'Update to vX' and is enabled", () => {
      mockUseLatestPromptVersion.mockReturnValue({
        currentVersion: 5,
        latestVersion: 5,
        nextVersion: 6,
        isOutdated: false,
        isLoading: false,
      });

      render(
        <TestWrapper formValues={{ versionMetadata: { versionNumber: 5, versionId: "v5", versionCreatedAt: new Date() } }}>
          <SavePromptButton onSave={vi.fn()} hasUnsavedChanges={true} />
        </TestWrapper>
      );

      const button = screen.getByTestId("save-prompt-button");
      expect(button).toHaveTextContent("Update to v6");
      expect(button).not.toBeDisabled();
    });
  });

  describe("when NOT at latest version with no changes", () => {
    it("shows 'Update to vX' and is enabled (allows rollback)", () => {
      mockUseLatestPromptVersion.mockReturnValue({
        currentVersion: 3,
        latestVersion: 5,
        nextVersion: 6,
        isOutdated: true,
        isLoading: false,
      });

      render(
        <TestWrapper formValues={{ versionMetadata: { versionNumber: 3, versionId: "v3", versionCreatedAt: new Date() } }}>
          <SavePromptButton onSave={vi.fn()} hasUnsavedChanges={false} />
        </TestWrapper>
      );

      const button = screen.getByTestId("save-prompt-button");
      expect(button).toHaveTextContent("Update to v6");
      expect(button).not.toBeDisabled();
    });
  });

  describe("when NOT at latest version with changes", () => {
    it("shows 'Update to vX' and is enabled", () => {
      mockUseLatestPromptVersion.mockReturnValue({
        currentVersion: 3,
        latestVersion: 5,
        nextVersion: 6,
        isOutdated: true,
        isLoading: false,
      });

      render(
        <TestWrapper formValues={{ versionMetadata: { versionNumber: 3, versionId: "v3", versionCreatedAt: new Date() } }}>
          <SavePromptButton onSave={vi.fn()} hasUnsavedChanges={true} />
        </TestWrapper>
      );

      const button = screen.getByTestId("save-prompt-button");
      expect(button).toHaveTextContent("Update to v6");
      expect(button).not.toBeDisabled();
    });
  });
});

