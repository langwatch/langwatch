/**
 * @vitest-environment jsdom
 *
 * Tests for CascadeArchiveDialog component.
 * Tests the cascading archive confirmation dialog behavior.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CascadeArchiveDialog } from "../CascadeArchiveDialog";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("CascadeArchiveDialog", () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    entityType: "workflow" as const,
    entityName: "My Workflow",
    relatedEntities: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders entity name in dialog", async () => {
    render(<CascadeArchiveDialog {...defaultProps} />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText(/My Workflow/)).toBeInTheDocument();
    });
  });

  it("shows dialog title based on entity type", async () => {
    render(<CascadeArchiveDialog {...defaultProps} entityType="evaluator" />, {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(screen.getByText("Delete evaluator?")).toBeInTheDocument();
    });
  });

  it("displays related workflows when provided", async () => {
    render(
      <CascadeArchiveDialog
        {...defaultProps}
        relatedEntities={{
          workflows: [
            { id: "wf-1", name: "Related Workflow 1" },
            { id: "wf-2", name: "Related Workflow 2" },
          ],
        }}
      />,
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(screen.getByText("Related Workflow 1")).toBeInTheDocument();
      expect(screen.getByText("Related Workflow 2")).toBeInTheDocument();
      expect(screen.getByText(/Workflows \(2\)/)).toBeInTheDocument();
    });
  });

  it("displays related evaluators when provided", async () => {
    render(
      <CascadeArchiveDialog
        {...defaultProps}
        relatedEntities={{
          evaluators: [{ id: "ev-1", name: "My Evaluator" }],
        }}
      />,
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(screen.getByText("My Evaluator")).toBeInTheDocument();
      expect(screen.getByText(/Evaluators \(1\)/)).toBeInTheDocument();
    });
  });

  it("displays related agents when provided", async () => {
    render(
      <CascadeArchiveDialog
        {...defaultProps}
        relatedEntities={{
          agents: [{ id: "ag-1", name: "My Agent" }],
        }}
      />,
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(screen.getByText("My Agent")).toBeInTheDocument();
      expect(screen.getByText(/Agents \(1\)/)).toBeInTheDocument();
    });
  });

  it("displays related monitors (online evaluations) when provided", async () => {
    render(
      <CascadeArchiveDialog
        {...defaultProps}
        relatedEntities={{
          monitors: [
            { id: "mon-1", name: "Online Eval 1" },
            { id: "mon-2", name: "Online Eval 2" },
          ],
        }}
      />,
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(screen.getByText("Online Eval 1")).toBeInTheDocument();
      expect(screen.getByText("Online Eval 2")).toBeInTheDocument();
      expect(screen.getByText(/Online Evaluations \(2\)/)).toBeInTheDocument();
    });
  });

  it("shows warning alert when related entities exist", async () => {
    render(
      <CascadeArchiveDialog
        {...defaultProps}
        relatedEntities={{
          evaluators: [{ id: "ev-1", name: "Test Evaluator" }],
        }}
      />,
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(screen.getByText("This will also affect:")).toBeInTheDocument();
    });
  });

  it("does not show warning alert when no related entities", async () => {
    render(<CascadeArchiveDialog {...defaultProps} relatedEntities={{}} />, {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(
        screen.queryByText("This will also affect:"),
      ).not.toBeInTheDocument();
    });
  });

  it("requires typing 'delete' to enable confirm button", async () => {
    const user = userEvent.setup();

    render(<CascadeArchiveDialog {...defaultProps} />, { wrapper: Wrapper });

    await waitFor(() => {
      const confirmButton = screen.getByTestId("cascade-archive-confirm-button");
      expect(confirmButton).toBeDisabled();
    });

    const input = screen.getByTestId("cascade-archive-confirm-input");
    await user.type(input, "delete");

    await waitFor(() => {
      const confirmButton = screen.getByTestId("cascade-archive-confirm-button");
      expect(confirmButton).not.toBeDisabled();
    });
  });

  it("calls onConfirm when delete is typed and button clicked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <CascadeArchiveDialog {...defaultProps} onConfirm={onConfirm} />,
      { wrapper: Wrapper },
    );

    const input = screen.getByTestId("cascade-archive-confirm-input");
    await user.type(input, "delete");

    const confirmButton = screen.getByTestId("cascade-archive-confirm-button");
    await user.click(confirmButton);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm when Enter is pressed after typing delete", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <CascadeArchiveDialog {...defaultProps} onConfirm={onConfirm} />,
      { wrapper: Wrapper },
    );

    const input = screen.getByTestId("cascade-archive-confirm-input");
    await user.type(input, "delete{Enter}");

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not call onConfirm when Enter pressed without typing delete", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <CascadeArchiveDialog {...defaultProps} onConfirm={onConfirm} />,
      { wrapper: Wrapper },
    );

    const input = screen.getByTestId("cascade-archive-confirm-input");
    await user.type(input, "wrong{Enter}");

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("calls onClose when Cancel button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<CascadeArchiveDialog {...defaultProps} onClose={onClose} />, {
      wrapper: Wrapper,
    });

    const cancelButton = screen.getByText("Cancel");
    await user.click(cancelButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows loading state when isLoading is true", async () => {
    render(<CascadeArchiveDialog {...defaultProps} isLoading={true} />, {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      const confirmButton = screen.getByTestId("cascade-archive-confirm-button");
      expect(confirmButton).toBeDisabled();
    });
  });

  it("shows loading spinner for related entities when isLoadingRelated is true", async () => {
    render(
      <CascadeArchiveDialog {...defaultProps} isLoadingRelated={true} />,
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(screen.getByText("Loading related items...")).toBeInTheDocument();
    });
  });

  it("truncates list when more than 5 entities", async () => {
    const manyMonitors = Array.from({ length: 8 }, (_, i) => ({
      id: `mon-${i}`,
      name: `Monitor ${i + 1}`,
    }));

    render(
      <CascadeArchiveDialog
        {...defaultProps}
        relatedEntities={{ monitors: manyMonitors }}
      />,
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      // First 5 should be visible
      expect(screen.getByText("Monitor 1")).toBeInTheDocument();
      expect(screen.getByText("Monitor 5")).toBeInTheDocument();
      // 6th should not be directly visible
      expect(screen.queryByText("Monitor 6")).not.toBeInTheDocument();
      // Should show "...and X more"
      expect(screen.getByText("...and 3 more")).toBeInTheDocument();
    });
  });

  it("is case insensitive for delete confirmation", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <CascadeArchiveDialog {...defaultProps} onConfirm={onConfirm} />,
      { wrapper: Wrapper },
    );

    const input = screen.getByTestId("cascade-archive-confirm-input");
    await user.type(input, "DELETE");

    const confirmButton = screen.getByTestId("cascade-archive-confirm-button");
    expect(confirmButton).not.toBeDisabled();

    await user.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
