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
  return dialogs[dialogs.length - 1]!;
}

/**
 * Helper to get dialog by data-state attribute.
 */
function getDialogByState(state: "open" | "closed") {
  const dialogs = screen.queryAllByRole("dialog");
  return dialogs.find((d) => d.getAttribute("data-state") === state);
}

describe("<AICreateModal/>", () => {
  describe("when open", () => {
    it("displays the provided title", () => {
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

    it("displays custom title", () => {
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

    it("displays character counter at 0 / 500", () => {
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

  describe("when user types in textarea", () => {
    it("updates character counter", () => {
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
      fireEvent.change(textarea, { target: { value: "Test description" } });

      expect(within(dialog).getByText("16 / 500")).toBeInTheDocument();
    });

    it("truncates text at maxLength", () => {
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
      fireEvent.change(textarea, { target: { value: "This is a very long description" } });

      expect(textarea).toHaveValue("This is a ");
      expect(within(dialog).getByText("10 / 10")).toBeInTheDocument();
    });
  });

  describe("when user clicks example pill", () => {
    it("fills textarea with template text", () => {
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
      fireEvent.click(within(dialog).getByText("Customer Support"));

      const textarea = within(dialog).getByRole("textbox");
      expect(textarea).toHaveValue(
        "A customer support agent that handles complaints. Test an angry customer who was charged twice and wants a refund."
      );
    });
  });

  describe("when user clicks Skip", () => {
    it("calls onSkip callback", () => {
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
  });

  describe("when user clicks Generate with AI", () => {
    it("calls onGenerate with description", async () => {
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

    it("displays generating state with spinner", async () => {
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
        expect(within(dialog).getByText("Generating...")).toBeInTheDocument();
      });
    });

    it("displays custom generating text", async () => {
      const onGenerate = vi.fn().mockImplementation(() => new Promise(() => {}));

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

  describe("when generation fails", () => {
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

    it("displays Try again button", async () => {
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

    it("displays Skip button", async () => {
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

    it("displays close button", async () => {
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
  });

  describe("when user clicks Try again", () => {
    it("retries generation", async () => {
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

    it("displays timeout error after 60 seconds", async () => {
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

      await act(async () => {
        vi.advanceTimersByTime(60000);
        await vi.runAllTimersAsync();
      });

      expect(within(dialog).getByText("Something went wrong")).toBeInTheDocument();
      expect(within(dialog).getByText(/timed out/i)).toBeInTheDocument();
    });
  });

  describe("when open is false", () => {
    it("renders dialog in closed state", () => {
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

      const dialogs = container.querySelectorAll('[role="dialog"]');
      const openDialogs = Array.from(dialogs).filter(
        (d) => d.getAttribute("data-state") === "open"
      );

      expect(openDialogs.length).toBe(0);
    });
  });

  describe("when open is true", () => {
    it("renders dialog in open state", () => {
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
