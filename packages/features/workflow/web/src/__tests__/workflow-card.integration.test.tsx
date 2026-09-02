/** @vitest-environment jsdom */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { WorkflowCardActions, WorkflowCardDisplay } from "../ui/elements/workflow-card";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderCard(children: React.ReactNode) {
  return render(<ChakraProvider value={defaultSystem}>{children}</ChakraProvider>);
}

describe("Workflow card", () => {
  beforeAll(() => vi.stubGlobal("ResizeObserver", ResizeObserverStub));
  afterAll(() => vi.unstubAllGlobals());
  afterEach(cleanup);

  it("renders workflow metadata and caller content", () => {
    renderCard(
      <WorkflowCardDisplay
        name="Judge workflow"
        icon="⚖️"
        description="Scores an answer"
        updatedAtLabel="3 minutes ago"
      >
        <span>status</span>
      </WorkflowCardDisplay>,
    );

    expect(screen.getByText("Judge workflow")).toBeTruthy();
    expect(screen.getByText("Scores an answer")).toBeTruthy();
    expect(screen.getByText("3 minutes ago")).toBeTruthy();
    expect(screen.getByText("status")).toBeTruthy();
  });

  it("exposes the actions allowed by copy state", async () => {
    const user = userEvent.setup();
    const onSyncFromSource = vi.fn();
    const onPushToCopies = vi.fn();

    renderCard(
      <WorkflowCardActions
        isCopy
        hasCopies
        sourceProjectPath="Acme / Core / Production"
        onSyncFromSource={onSyncFromSource}
        onPushToCopies={onPushToCopies}
        onCopy={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    await user.click(screen.getByLabelText("Workflow actions"));
    await user.click(await screen.findByRole("menuitem", { name: /Update from source/ }));
    expect(onSyncFromSource).toHaveBeenCalledOnce();

    await user.click(screen.getByLabelText("Workflow actions"));
    await user.click(await screen.findByRole("menuitem", { name: /Push to replicas/ }));
    expect(onPushToCopies).toHaveBeenCalledOnce();
  });
});
