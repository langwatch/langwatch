/** @vitest-environment jsdom */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WorkflowCreateDialog,
  type WorkflowTemplateCardProps,
} from "../ui/elements/workflow-create-dialog.tsx";

function TemplateCard({ testId, name, onClick }: WorkflowTemplateCardProps) {
  return (
    <button type="button" data-testid={testId} onClick={onClick}>
      {name}
    </button>
  );
}

describe("WorkflowCreateDialog", () => {
  afterEach(cleanup);

  it("selects the blank template and resets to selection after closing", () => {
    const props = {
      onClose: vi.fn(),
      onImportError: vi.fn(),
      renderContentBoundary: (children: ReactNode) => children,
      renderForm: ({ template }: { template: { name: string } }) => (
        <div data-testid="workflow-form">{template.name}</div>
      ),
      renderTemplateCard: (card: WorkflowTemplateCardProps) => <TemplateCard {...card} />,
    };

    const result = renderWithDesignSystem(<WorkflowCreateDialog {...props} open />);

    fireEvent.click(screen.getByTestId("new-workflow-card-blank"));
    expect(screen.getByTestId("workflow-form").textContent).toBe("New Workflow");

    result.rerender(<WorkflowCreateDialog {...props} open={false} />);
    result.rerender(<WorkflowCreateDialog {...props} open />);

    expect(screen.getByTestId("new-workflow-card-blank")).not.toBeNull();
  });
});
