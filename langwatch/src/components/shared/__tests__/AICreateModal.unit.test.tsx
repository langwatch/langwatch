/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  act,
  within,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { AICreateModal } from "../AICreateModal";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const defaultExampleTemplates = [
  {
    label: "Customer Support",
    text: "A customer support agent that handles complaints. Test an angry customer who was charged twice and wants a refund.",
  },
  {
    label: "RAG Q&A",
    text: "A knowledge bot that answers questions from documentation. Test a question that requires combining info from multiple sources.",
  },
  {
    label: "Tool-calling Agent",
    text: "An agent that uses tools to complete tasks. Test a request that requires calling multiple tools in sequence.",
  },
];

/**
 * Helper to get the dialog content element.
 * Chakra Dialog renders multiple DOM nodes, so we use role="dialog" to find the actual content.
 */
function getDialogContent() {
  const dialogs = screen.getAllByRole("dialog");
  // Return the last one as Chakra may render multiple
  return dialogs[dialogs.length - 1]!;
}

/**
 * Helper to get dialog by data-state attribute.
 * When open=false, Chakra still renders the dialog but with data-state="closed"
 */
function getDialogByState(state: "open" | "closed") {
  const dialogs = screen.queryAllByRole("dialog");
  return dialogs.find((d) => d.getAttribute("data-state") === state);
}

describe("<AICreateModal/>", () => {
  describe("when in idle state", () => {
    it("displays the title", () => {
      render(
        <AICreateModal
          open={true}
          onClose={vi.fn()}
          title="Create new scenario"
          exampleTemplates={defaultExampleTemplates}
          onGenerate={vi.fn()}
          onSkip={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      expect(within(dialog).getByText("Create new scenario")).toBeInTheDocument();
    });

    it("displays custom title when provided", () => {
      render(
        <AICreateModal
          open={true}
          onClose={vi.fn()}
          title="Create new prompt"
          exampleTemplates={defaultExampleTemplates}
          onGenerate={vi.fn()}
          onSkip={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      expect(within(dialog).getByText("Create new prompt")).toBeInTheDocument();
    });

    it("displays textarea with custom placeholder", () => {
      render(
        <AICreateModal
          open={true}
          onClose={vi.fn()}
          title="Create new scenario"
          placeholder="Describe your custom scenario..."
          exampleTemplates={defaultExampleTemplates}
          onGenerate={vi.fn()}
          onSkip={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      expect(
        within(dialog).getByPlaceholderText("Describe your custom scenario...")
      ).toBeInTheDocument();
    });

    it("displays character counter showing 0 / 500", () => {
      render(
        <AICreateModal
          open={true}
          onClose={vi.fn()}
          title="Create new scenario"
          exampleTemplates={defaultExampleTemplates}
          onGenerate={vi.fn()}
          onSkip={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      expect(within(dialog).getByText("0 / 500")).toBeInTheDocument();
    });

    it("displays character counter with custom maxLength", () => {
      render(
        <AICreateModal
          open={true}
          onClose={vi.fn()}
          title="Create new scenario"
          exampleTemplates={defaultExampleTemplates}
          onGenerate={vi.fn()}
          onSkip={vi.fn()}
          maxLength={300}
        />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      expect(within(dialog).getByText("0 / 300")).toBeInTheDocument();
    });

    it("updates character counter when typing", async () => {
      render(
        <AICreateModal
          open={true}
          onClose={vi.fn()}
          title="Create new scenario"
          exampleTemplates={defaultExampleTemplates}
          onGenerate={vi.fn()}
          onSkip={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      const textarea = within(dialog).getByRole("textbox");

      // Use fireEvent instead of userEvent due to Chakra's pointer-events handling
      fireEvent.change(textarea, { target: { value: "Test description" } });

      expect(within(dialog).getByText("16 / 500")).toBeInTheDocument();
    });

    it("enforces character limit", async () => {
      render(
        <AICreateModal
          open={true}
          onClose={vi.fn()}
          title="Create new scenario"
          exampleTemplates={defaultExampleTemplates}
          onGenerate={vi.fn()}
          onSkip={vi.fn()}
          maxLength={10}
        />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      const textarea = within(dialog).getByRole("textbox");

      // Use fireEvent instead of userEvent
      fireEvent.change(textarea, { target: { value: "This is a very long description" } });

      // Should be truncated to maxLength
      expect(textarea).toHaveValue("This is a ");
      expect(within(dialog).getByText("10 / 10")).toBeInTheDocument();
    });

    it("displays example pills", () => {
      render(
        <AICreateModal
          open={true}
          onClose={vi.fn()}
          title="Create new scenario"
          exampleTemplates={defaultExampleTemplates}
          onGenerate={vi.fn()}
          onSkip={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      expect(within(dialog).getByText("Customer Support")).toBeInTheDocument();
      expect(within(dialog).getByText("RAG Q&A")).toBeInTheDocument();
      expect(within(dialog).getByText("Tool-calling Agent")).toBeInTheDocument();
    });

    it("fills textarea when clicking example pill", async () => {
      render(
        <AICreateModal
          open={true}
          onClose={vi.fn()}
          title="Create new scenario"
          exampleTemplates={defaultExampleTemplates}
          onGenerate={vi.fn()}
          onSkip={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      const pillButton = within(dialog).getByText("Customer Support");
      fireEvent.click(pillButton);

      const textarea = within(dialog).getByRole("textbox");
      expect(textarea).toHaveValue(
        "A customer support agent that handles complaints. Test an angry customer who was charged twice and wants a refund."
      );
    });

    it("displays Generate with AI button", () => {
      render(
        <AICreateModal
          open={true}
          onClose={vi.fn()}
          title="Create new scenario"
          exampleTemplates={defaultExampleTemplates}
          onGenerate={vi.fn()}
          onSkip={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      expect(
        within(dialog).getByRole("button", { name: /generate with ai/i })
      ).toBeInTheDocument();
    });

    it("displays Skip button", () => {
      render(
        <AICreateModal
          open={true}
          onClose={vi.fn()}
          title="Create new scenario"
          exampleTemplates={defaultExampleTemplates}
          onGenerate={vi.fn()}
          onSkip={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      expect(
        within(dialog).getByRole("button", { name: /skip/i })
      ).toBeInTheDocument();
    });

    it("calls onSkip when Skip button is clicked", async () => {
      const onSkip = vi.fn();

      render(
        <AICreateModal
          open={true}
          onClose={vi.fn()}
          title="Create new scenario"
          exampleTemplates={defaultExampleTemplates}
          onGenerate={vi.fn()}
          onSkip={onSkip}
        />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      fireEvent.click(within(dialog).getByRole("button", { name: /skip/i }));

      expect(onSkip).toHaveBeenCalledTimes(1);
    });

    it("calls onGenerate with description when Generate button is clicked", async () => {
      const onGenerate = vi.fn().mockResolvedValue(undefined);

      render(
        <AICreateModal
          open={true}
          onClose={vi.fn()}
          title="Create new scenario"
          exampleTemplates={defaultExampleTemplates}
          onGenerate={onGenerate}
          onSkip={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      const textarea = within(dialog).getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Test description" } });
      fireEvent.click(
        within(dialog).getByRole("button", { name: /generate with ai/i })
      );

      await waitFor(() => {
        expect(onGenerate).toHaveBeenCalledWith("Test description");
      });
    });

    it("displays close button", () => {
      render(
        <AICreateModal
          open={true}
          onClose={vi.fn()}
          title="Create new scenario"
          exampleTemplates={defaultExampleTemplates}
          onGenerate={vi.fn()}
          onSkip={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      expect(
        within(dialog).getByRole("button", { name: /close/i })
      ).toBeInTheDocument();
    });
  });

  describe("when in generating state", () => {
    it("displays spinner and default generating text", async () => {
      const onGenerate = vi.fn().mockImplementation(() => new Promise(() => {})); // Never resolves

      render(
        <AICreateModal
          open={true}
          onClose={vi.fn()}
          title="Create new scenario"
          exampleTemplates={defaultExampleTemplates}
          onGenerate={onGenerate}
          onSkip={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      const textarea = within(dialog).getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Test description" } });
      fireEvent.click(
        within(dialog).getByRole("button", { name: /generate with ai/i })
      );

      await waitFor(() => {
        expect(within(dialog).getByText("Generating...")).toBeInTheDocument();
      });
    });

    it("displays custom generating text when provided", async () => {
      const onGenerate = vi.fn().mockImplementation(() => new Promise(() => {})); // Never resolves

      render(
        <AICreateModal
          open={true}
          onClose={vi.fn()}
          title="Create new prompt"
          exampleTemplates={defaultExampleTemplates}
          onGenerate={onGenerate}
          onSkip={vi.fn()}
          generatingText="Generating prompt..."
        />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      const textarea = within(dialog).getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Test description" } });
      fireEvent.click(
        within(dialog).getByRole("button", { name: /generate with ai/i })
      );

      await waitFor(() => {
        expect(within(dialog).getByText("Generating prompt...")).toBeInTheDocument();
      });
    });

    it("hides close button during generation", async () => {
      const onGenerate = vi.fn().mockImplementation(() => new Promise(() => {}));

      render(
        <AICreateModal
          open={true}
          onClose={vi.fn()}
          title="Create new scenario"
          exampleTemplates={defaultExampleTemplates}
          onGenerate={onGenerate}
          onSkip={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      const textarea = within(dialog).getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Test description" } });
      fireEvent.click(
        within(dialog).getByRole("button", { name: /generate with ai/i })
      );

      await waitFor(() => {
        expect(
          within(dialog).queryByRole("button", { name: /close/i })
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("when in error state", () => {
    it("displays error title and message", async () => {
      const onGenerate = vi.fn().mockRejectedValue(new Error("API connection failed"));

      render(
        <AICreateModal
          open={true}
          onClose={vi.fn()}
          title="Create new scenario"
          exampleTemplates={defaultExampleTemplates}
          onGenerate={onGenerate}
          onSkip={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      const textarea = within(dialog).getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Test description" } });
      fireEvent.click(
        within(dialog).getByRole("button", { name: /generate with ai/i })
      );

      await waitFor(() => {
        expect(within(dialog).getByText("Something went wrong")).toBeInTheDocument();
      });
      expect(within(dialog).getByText("API connection failed")).toBeInTheDocument();
    });

    it("displays Try again button in error state", async () => {
      const onGenerate = vi.fn().mockRejectedValue(new Error("API error"));

      render(
        <AICreateModal
          open={true}
          onClose={vi.fn()}
          title="Create new scenario"
          exampleTemplates={defaultExampleTemplates}
          onGenerate={onGenerate}
          onSkip={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      const textarea = within(dialog).getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Test description" } });
      fireEvent.click(
        within(dialog).getByRole("button", { name: /generate with ai/i })
      );

      await waitFor(() => {
        expect(
          within(dialog).getByRole("button", { name: /try again/i })
        ).toBeInTheDocument();
      });
    });

    it("displays Skip button in error state", async () => {
      const onGenerate = vi.fn().mockRejectedValue(new Error("API error"));

      render(
        <AICreateModal
          open={true}
          onClose={vi.fn()}
          title="Create new scenario"
          exampleTemplates={defaultExampleTemplates}
          onGenerate={onGenerate}
          onSkip={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      const textarea = within(dialog).getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Test description" } });
      fireEvent.click(
        within(dialog).getByRole("button", { name: /generate with ai/i })
      );

      await waitFor(() => {
        expect(
          within(dialog).getByRole("button", { name: /skip/i })
        ).toBeInTheDocument();
      });
    });

    it("displays close button in error state", async () => {
      const onGenerate = vi.fn().mockRejectedValue(new Error("API error"));

      render(
        <AICreateModal
          open={true}
          onClose={vi.fn()}
          title="Create new scenario"
          exampleTemplates={defaultExampleTemplates}
          onGenerate={onGenerate}
          onSkip={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      const textarea = within(dialog).getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Test description" } });
      fireEvent.click(
        within(dialog).getByRole("button", { name: /generate with ai/i })
      );

      await waitFor(() => {
        expect(
          within(dialog).getByRole("button", { name: /close/i })
        ).toBeInTheDocument();
      });
    });

    it("retries generation when Try again is clicked", async () => {
      const onGenerate = vi
        .fn()
        .mockRejectedValueOnce(new Error("API error"))
        .mockResolvedValueOnce(undefined);

      render(
        <AICreateModal
          open={true}
          onClose={vi.fn()}
          title="Create new scenario"
          exampleTemplates={defaultExampleTemplates}
          onGenerate={onGenerate}
          onSkip={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      const textarea = within(dialog).getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Test description" } });
      fireEvent.click(
        within(dialog).getByRole("button", { name: /generate with ai/i })
      );

      await waitFor(() => {
        expect(
          within(dialog).getByRole("button", { name: /try again/i })
        ).toBeInTheDocument();
      });

      fireEvent.click(within(dialog).getByRole("button", { name: /try again/i }));

      await waitFor(() => {
        expect(onGenerate).toHaveBeenCalledTimes(2);
      });
      expect(onGenerate).toHaveBeenLastCalledWith("Test description");
    });
  });

  describe("when generation times out", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows timeout error after 60 seconds", async () => {
      const onGenerate = vi.fn().mockImplementation(() => new Promise(() => {}));

      render(
        <AICreateModal
          open={true}
          onClose={vi.fn()}
          title="Create new scenario"
          exampleTemplates={defaultExampleTemplates}
          onGenerate={onGenerate}
          onSkip={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      const textarea = within(dialog).getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Test description" } });
      fireEvent.click(
        within(dialog).getByRole("button", { name: /generate with ai/i })
      );

      // Advance time by 60 seconds and flush promises
      await act(async () => {
        vi.advanceTimersByTime(60000);
        // Allow microtasks to flush
        await vi.runAllTimersAsync();
      });

      // The timeout should have triggered by now
      expect(within(dialog).getByText("Something went wrong")).toBeInTheDocument();
      expect(within(dialog).getByText(/timed out/i)).toBeInTheDocument();
    });
  });

  describe("modal visibility", () => {
    it("renders dialog with data-state=closed when open is false", () => {
      const { container } = render(
        <AICreateModal
          open={false}
          onClose={vi.fn()}
          title="Create new scenario"
          exampleTemplates={defaultExampleTemplates}
          onGenerate={vi.fn()}
          onSkip={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      // Check that dialog is in closed state or not rendered
      const dialogs = container.querySelectorAll('[role="dialog"]');
      const closedDialogs = Array.from(dialogs).filter(
        (d) => d.getAttribute("data-state") === "closed"
      );
      const openDialogs = Array.from(dialogs).filter(
        (d) => d.getAttribute("data-state") === "open"
      );

      // When open=false, either no dialogs or only closed dialogs should exist
      expect(openDialogs.length).toBe(0);
    });

    it("renders dialog with data-state=open when open is true", () => {
      render(
        <AICreateModal
          open={true}
          onClose={vi.fn()}
          title="Create new scenario"
          exampleTemplates={defaultExampleTemplates}
          onGenerate={vi.fn()}
          onSkip={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      const openDialog = getDialogByState("open");
      expect(openDialog).toBeDefined();
    });
  });
});
