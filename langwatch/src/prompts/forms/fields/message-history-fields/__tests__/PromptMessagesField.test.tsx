/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormProvider, useFieldArray, useForm } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompts";
import { PromptMessagesField, type PromptEditingMode } from "../PromptMessagesField";

// Mock complex dependencies
vi.mock("~/components/variables", () => ({
  PromptTextAreaWithVariables: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      data-testid="prompt-textarea"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

/**
 * Helper to open the editing mode menu and click an option.
 * The menu is triggered by clicking the title (Prompt/Messages).
 */
const switchEditingMode = async (
  user: ReturnType<typeof userEvent.setup>,
  targetMode: "prompt" | "messages",
) => {
  // Find and click the menu trigger (the title text)
  const titles = screen.queryAllByText(/^(Prompt|Messages)$/);
  const menuTrigger = titles[0]; // The first one is the title/trigger
  if (menuTrigger) {
    await user.click(menuTrigger);
    // Wait for menu to open and click the target mode
    const menuItem = await screen.findByTestId(`editing-mode-${targetMode}`);
    await user.click(menuItem);
    // Wait for menu to close and state to update
    await waitFor(() => {
      expect(screen.queryByTestId(`editing-mode-${targetMode}`)).not.toBeInTheDocument();
    });
  }
};

type WrapperProps = {
  defaultMessages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  defaultMode?: PromptEditingMode;
};

// Wrapper component that provides form context
function TestWrapper({ defaultMessages, defaultMode }: WrapperProps) {
  const methods = useForm<PromptConfigFormValues>({
    defaultValues: {
      handle: null,
      scope: "PROJECT",
      version: {
        configData: {
          llm: { model: "test-model", temperature: 1, maxTokens: 1000 },
          messages: defaultMessages ?? [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "{{input}}" },
          ],
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
        },
      },
    },
  });

  const messageFields = useFieldArray({
    control: methods.control,
    name: "version.configData.messages",
  });

  return (
    <ChakraProvider value={defaultSystem}>
      <FormProvider {...methods}>
        <PromptMessagesField
          messageFields={messageFields}
          availableFields={[{ identifier: "input", type: "str" }]}
          otherNodesFields={{}}
          defaultMode={defaultMode}
        />
      </FormProvider>
    </ChakraProvider>
  );
}

const renderComponent = (props: WrapperProps = {}) => {
  return render(<TestWrapper {...props} />);
};

describe("PromptMessagesField", () => {
  afterEach(() => {
    cleanup();
  });

  describe("editing mode menu", () => {
    it("defaults to Prompt mode", () => {
      renderComponent();

      // The title should show "Prompt"
      expect(screen.getByText("Prompt")).toBeInTheDocument();
    });

    it("shows Messages as title when defaultMode is messages", () => {
      renderComponent({ defaultMode: "messages" });

      // Title should be "Messages"
      const title = screen.getByText("Messages");
      expect(title).toBeInTheDocument();
    });

    it("opens menu with mode options when title is clicked", async () => {
      const user = userEvent.setup();
      renderComponent();

      // Click the title to open the menu
      await user.click(screen.getByText("Prompt"));

      // Menu items should appear
      expect(screen.getByTestId("editing-mode-prompt")).toBeInTheDocument();
      expect(screen.getByTestId("editing-mode-messages")).toBeInTheDocument();
    });

    it("switches to Messages mode when Messages option is clicked", async () => {
      const user = userEvent.setup();
      renderComponent();

      await switchEditingMode(user, "messages");

      // Should now show all messages (2 textareas)
      const textareas = screen.getAllByTestId("prompt-textarea");
      expect(textareas).toHaveLength(2);
    });

    it("switches back to Prompt mode when Prompt option is clicked", async () => {
      const user = userEvent.setup();
      renderComponent({ defaultMode: "messages" });

      await switchEditingMode(user, "prompt");

      // Should now show only system message (1 textarea)
      const textareas = screen.getAllByTestId("prompt-textarea");
      expect(textareas).toHaveLength(1);
    });
  });

  describe("Prompt mode", () => {
    it("shows only the system message textarea", () => {
      renderComponent();

      // Should have exactly one textarea (system prompt)
      const textareas = screen.getAllByTestId("prompt-textarea");
      expect(textareas).toHaveLength(1);
    });

    it("does not show role labels", () => {
      renderComponent();

      expect(screen.queryByText("SYSTEM")).not.toBeInTheDocument();
      expect(screen.queryByText("USER")).not.toBeInTheDocument();
    });

    it("does not show add message button in Prompt mode", () => {
      renderComponent();

      // Count the buttons - should only have the title trigger (which is a button-like element)
      const buttons = screen.getAllByRole("button");
      // Should be exactly 1: the menu trigger
      expect(buttons).toHaveLength(1);
    });
  });

  describe("Messages mode", () => {
    it("shows all messages", () => {
      renderComponent({ defaultMode: "messages" });

      // Should have two textareas (system + user)
      const textareas = screen.getAllByTestId("prompt-textarea");
      expect(textareas).toHaveLength(2);
    });

    it("shows system label for system message", () => {
      renderComponent({ defaultMode: "messages" });

      // System message gets a "System prompt" label from PropertySectionTitle
      expect(screen.getByText("System prompt")).toBeInTheDocument();
    });

    it("shows role labels for user/assistant messages", () => {
      renderComponent({
        defaultMode: "messages",
        defaultMessages: [
          { role: "system", content: "System prompt" },
          { role: "user", content: "User message" },
          { role: "assistant", content: "Assistant response" },
        ],
      });

      // Role labels are rendered by MessageRoleLabel component
      expect(screen.getByText("user")).toBeInTheDocument();
      expect(screen.getByText("assistant")).toBeInTheDocument();
    });

    it("shows add message button in Messages mode", () => {
      renderComponent({ defaultMode: "messages" });

      // In Messages mode, should have more than 1 button (menu trigger + add + remove)
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(1);
    });
  });

  describe("content preservation", () => {
    it("preserves message content when switching from Prompt to Messages mode", async () => {
      const user = userEvent.setup();
      renderComponent();

      // Switch to Messages mode
      await switchEditingMode(user, "messages");

      // Should still have 2 messages
      const textareas = screen.getAllByTestId("prompt-textarea");
      expect(textareas).toHaveLength(2);
    });

    it("preserves user message when switching from Messages to Prompt mode", async () => {
      const user = userEvent.setup();
      renderComponent({ defaultMode: "messages" });

      // Switch to Prompt mode
      await switchEditingMode(user, "prompt");

      // Should only show 1 textarea (system)
      const textareas = screen.getAllByTestId("prompt-textarea");
      expect(textareas).toHaveLength(1);

      // Switch back to Messages mode
      await switchEditingMode(user, "messages");

      // User message should still be there
      const textareasAfter = screen.getAllByTestId("prompt-textarea");
      expect(textareasAfter).toHaveLength(2);
    });

    it("preserves all messages when switching modes multiple times", async () => {
      const user = userEvent.setup();
      renderComponent({
        defaultMode: "messages",
        defaultMessages: [
          { role: "system", content: "System" },
          { role: "user", content: "User" },
          { role: "assistant", content: "Assistant" },
        ],
      });

      // Switch to Prompt mode
      await switchEditingMode(user, "prompt");

      // Switch back to Messages mode
      await switchEditingMode(user, "messages");

      // All 3 messages should still be there
      const textareas = screen.getAllByTestId("prompt-textarea");
      expect(textareas).toHaveLength(3);
    });
  });

  describe("system message creation", () => {
    it("creates system message when switching to Prompt mode if none exists", async () => {
      const user = userEvent.setup();
      renderComponent({
        defaultMode: "messages",
        defaultMessages: [{ role: "user", content: "Just a user message" }],
      });

      // Switch to Prompt mode - should create system message
      await switchEditingMode(user, "prompt");

      // Should have a textarea for the new system message
      expect(screen.getByTestId("prompt-textarea")).toBeInTheDocument();
    });
  });
});
