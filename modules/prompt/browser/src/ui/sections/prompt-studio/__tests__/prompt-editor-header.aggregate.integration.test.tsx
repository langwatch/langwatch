/**
 * @vitest-environment jsdom
 * An aggregate (ADR-177) refuses every write: a carried-over tab offers neither Save nor Deploy.
 * @see specs/governance/aggregate-project.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { PromptConfigFormValues } from "@langwatch/prompt-contract";
import { cleanup, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PromptEditorHeader } from "../prompt-editor-header.tsx";

const { projectRef } = vi.hoisted(() => ({
  projectRef: { current: { id: "proj-1", slug: "web-app", kind: "application" } },
}));

vi.mock("../../../../behavior/use-prompt-project.ts", () => ({
  usePromptProject: () => ({ project: projectRef.current }),
}));

vi.mock("../fields/model-select-field-mini.tsx", () => ({ ModelSelectFieldMini: () => null }));

vi.mock("../version-history-button.tsx", () => ({ VersionHistoryButton: () => null }));

vi.mock("../dialogs/deploy-prompt-dialog.tsx", () => ({ DeployPromptDialog: () => null }));

vi.mock("../dialogs/generate-prompt-api-snippet-dialog.tsx", () => {
  const Dialog = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  Dialog.Trigger = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { GeneratePromptApiSnippetDialog: Dialog };
});

// The save button reads the prompt's latest version from the server.
vi.mock("../../../../behavior/use-latest-prompt-version.ts", () => ({
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
    <FormProvider {...methods}>
      <PromptEditorHeader onSave={vi.fn()} hasUnsavedChanges />
    </FormProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe("<PromptEditorHeader/>", () => {
  describe("given an ordinary project", () => {
    it("offers Save and Deploy", () => {
      projectRef.current = { id: "proj-1", slug: "web-app", kind: "application" };

      renderWithDesignSystem(<Header />);

      expect(screen.getByTestId("save-prompt-button")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Deploy" })).toBeTruthy();
    });
  });

  describe("given an aggregate project with a playground tab carried over", () => {
    /** @scenario "The app marks the aggregate and offers no way to add data to it" */
    it("offers neither Save nor Deploy", () => {
      projectRef.current = { id: "agg-1", slug: "company-view", kind: "aggregate" };

      renderWithDesignSystem(<Header />);

      expect(screen.queryByTestId("save-prompt-button")).toBeNull();
      expect(screen.queryByRole("button", { name: "Deploy" })).toBeNull();
    });
  });
});
