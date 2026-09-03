/** @vitest-environment jsdom */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WorkflowCreateDialog,
  type WorkflowTemplateCardProps,
} from "../ui/elements/workflow-create-dialog";

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

    const result = render(
      <ChakraProvider value={defaultSystem}>
        <WorkflowCreateDialog {...props} open />
      </ChakraProvider>,
    );

    fireEvent.click(screen.getByTestId("new-workflow-card-blank"));
    expect(screen.getByTestId("workflow-form").textContent).toBe("New Workflow");

    result.rerender(
      <ChakraProvider value={defaultSystem}>
        <WorkflowCreateDialog {...props} open={false} />
      </ChakraProvider>,
    );
    result.rerender(
      <ChakraProvider value={defaultSystem}>
        <WorkflowCreateDialog {...props} open />
      </ChakraProvider>,
    );

    expect(screen.getByTestId("new-workflow-card-blank")).not.toBeNull();
  });
});
