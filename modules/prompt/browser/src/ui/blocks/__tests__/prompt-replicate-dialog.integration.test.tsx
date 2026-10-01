/**
 * @vitest-environment jsdom
 * @see specs/prompts/prompt-studio-page.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// A native <select> stands in for the Ark listbox, which jsdom cannot open.
vi.mock("@langwatch/design-system/select", () => {
  const Root = ({
    children,
    collection,
    value,
    onValueChange,
  }: {
    children: ReactNode;
    collection: { items: { label: string; value: string }[] };
    value: string[];
    onValueChange: (details: { value: string[] }) => void;
  }) => (
    <div>
      <select
        aria-label="Target Project"
        value={value[0] ?? ""}
        onChange={(event) => onValueChange({ value: [event.target.value] })}
      >
        <option value="">Select project</option>
        {collection.items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      {children}
    </div>
  );

  return {
    Select: {
      Root,
      Trigger: () => null,
      Content: ({ children }: { children: ReactNode }) => <>{children}</>,
      Item: ({ children }: { children: ReactNode }) => <div>{children}</div>,
      ValueText: () => null,
    },
  };
});

import { PromptReplicateDialog } from "../prompt-replicate-dialog.tsx";

const projects = [
  { value: "project-admin", label: "Admins / api", hasCreatePermission: true },
  { value: "project-viewer", label: "Viewers / docs", hasCreatePermission: false },
];

function renderDialog(onCopy: (targetProjectId: string) => Promise<void>) {
  renderWithDesignSystem(
    <PromptReplicateDialog
      open
      promptName="pizza-prompt"
      projects={projects}
      isLoading={false}
      onClose={() => undefined}
      onCopy={onCopy}
    />,
  );
}

afterEach(() => cleanup());

describe("the Replicate dialog on a prompt", () => {
  /** @scenario "Replicating a prompt cannot target a project the reader may not create in" */
  it("marks a project the reader may not create in and never lets it be chosen", () => {
    const onCopy = vi.fn().mockResolvedValue(undefined);
    renderDialog(onCopy);

    expect(screen.getAllByText("(no permission)")).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("Target Project"), {
      target: { value: "project-viewer" },
    });
    const replicate = screen.getByRole("button", { name: "Replicate" });
    fireEvent.click(replicate);

    expect(replicate).toBeDisabled();
    expect(onCopy).not.toHaveBeenCalled();
  });

  /** @scenario "Replicating a prompt cannot target a project the reader may not create in" */
  it("replicates into a project the reader may create in", () => {
    const onCopy = vi.fn().mockResolvedValue(undefined);
    renderDialog(onCopy);

    fireEvent.change(screen.getByLabelText("Target Project"), {
      target: { value: "project-admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Replicate" }));

    expect(onCopy).toHaveBeenCalledWith("project-admin");
  });
});
