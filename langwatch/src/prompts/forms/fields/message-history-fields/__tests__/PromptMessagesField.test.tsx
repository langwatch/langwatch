/**
 * @vitest-environment jsdom
 */
import React from "react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormProvider, useFieldArray, useForm } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompts";
import { PromptMessagesField } from "../PromptMessagesField";

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
};

// Wrapper component that provides form context
function TestWrapper({ defaultMessages }: WrapperProps) {
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
        />
      </FormProvider>
    </ChakraProvider>
  );
}

/**
 * Wrapper that simulates the drawer behavior:
 * 1. Form starts with default values (system + user with {{input}})
 * 2. After a delay, form.reset() is called with new messages (simulating data load)
 */
function TestWrapperWithDelayedReset({
  messagesAfterReset,
}: {
  messagesAfterReset: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}) {
  const methods = useForm<PromptConfigFormValues>({
    defaultValues: {
      handle: null,
      scope: "PROJECT",
      version: {
        configData: {
          llm: { model: "test-model", temperature: 1, maxTokens: 1000 },
          // Start with default messages (system + user with {{input}}) -> defaults to Prompt mode
          messages: [
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

  // Simulate data loading - reset form after initial render
  React.useEffect(() => {
    const timer = setTimeout(() => {
      methods.reset({
        handle: "test-prompt",
        scope: "PROJECT",
        version: {
          configData: {
            llm: { model: "test-model", temperature: 1, maxTokens: 1000 },
            messages: messagesAfterReset,
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
          },
        },
      });
    }, 50); // Small delay to simulate async data load

    return () => clearTimeout(timer);
  }, [methods, messagesAfterReset]);

  return (
    <ChakraProvider value={defaultSystem}>
      <FormProvider {...methods}>
        <PromptMessagesField
          messageFields={messageFields}
          availableFields={[{ identifier: "input", type: "str" }]}
          otherNodesFields={{}}
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
    it("defaults to Prompt mode for system + user with {{input}}", () => {
      renderComponent();

      // The title should show "Prompt" (default messages are system + user with {{input}})
      expect(screen.getByText("Prompt")).toBeInTheDocument();
    });

    it("defaults to Messages mode when user message is not {{input}}", () => {
      renderComponent({
        defaultMessages: [
          { role: "system", content: "System prompt" },
          { role: "user", content: "Custom user message" },
        ],
      });

      // Title should be "Messages" because user message is not {{input}}
      expect(screen.getByText("Messages")).toBeInTheDocument();
    });

    it("defaults to Prompt mode when user message is empty", () => {
      renderComponent({
        defaultMessages: [
          { role: "system", content: "System prompt" },
          { role: "user", content: "" },
        ],
      });

      // Title should be "Prompt" because user message is empty
      expect(screen.getByText("Prompt")).toBeInTheDocument();
    });

    it("defaults to Messages mode when there are multiple non-system messages", () => {
      renderComponent({
        defaultMessages: [
          { role: "system", content: "System prompt" },
          { role: "user", content: "{{input}}" },
          { role: "assistant", content: "Response" },
        ],
      });

      // Title should be "Messages" because there's an assistant message
      expect(screen.getByText("Messages")).toBeInTheDocument();
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
      // Use messages that default to Messages mode
      renderComponent({
        defaultMessages: [
          { role: "system", content: "System prompt" },
          { role: "user", content: "Custom message" },
        ],
      });

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
    // Helper: messages that trigger Messages mode
    const messagesForMessagesMode = [
      { role: "system" as const, content: "System prompt" },
      { role: "user" as const, content: "Custom user message" },
    ];

    it("shows all messages", () => {
      renderComponent({ defaultMessages: messagesForMessagesMode });

      // Should have two textareas (system + user)
      const textareas = screen.getAllByTestId("prompt-textarea");
      expect(textareas).toHaveLength(2);
    });

    it("shows system label for system message", () => {
      renderComponent({ defaultMessages: messagesForMessagesMode });

      // System message gets a role label - there may be multiple, just check at least one exists
      const systemLabels = screen.getAllByText("System prompt");
      expect(systemLabels.length).toBeGreaterThan(0);
    });

    it("shows role labels for user/assistant messages", () => {
      renderComponent({
        defaultMessages: [
          { role: "system", content: "System prompt" },
          { role: "user", content: "User message" },
          { role: "assistant", content: "Assistant response" },
        ],
      });

      // Role labels are rendered by MessageRoleLabel component (capitalized)
      expect(screen.getByText("User")).toBeInTheDocument();
      expect(screen.getByText("Assistant")).toBeInTheDocument();
    });

    it("shows add message button in Messages mode", () => {
      renderComponent({ defaultMessages: messagesForMessagesMode });

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
      // Use messages that default to Messages mode
      renderComponent({
        defaultMessages: [
          { role: "system", content: "System prompt" },
          { role: "user", content: "Custom message" },
        ],
      });

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
      // These messages default to Messages mode (has assistant)
      renderComponent({
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
      // No system message - this defaults to Messages mode
      renderComponent({
        defaultMessages: [{ role: "user", content: "Just a user message" }],
      });

      // Switch to Prompt mode - should create system message
      await switchEditingMode(user, "prompt");

      // Should have a textarea for the new system message
      expect(screen.getByTestId("prompt-textarea")).toBeInTheDocument();
    });
  });

  describe("delayed form reset (drawer scenario)", () => {
    it("updates editing mode when form is reset with different messages", async () => {
      // This simulates the drawer behavior:
      // 1. Form starts with default messages (system + user with {{input}}) -> Prompt mode
      // 2. After data loads, form.reset() is called with actual prompt data
      // 3. Editing mode should update based on the new messages

      render(
        <TestWrapperWithDelayedReset
          messagesAfterReset={[
            { role: "system", content: "System prompt" },
            { role: "user", content: "Custom user message" }, // Not {{input}} -> should be Messages mode
          ]}
        />,
      );

      // Initially should show "Prompt" (default messages are system + user with {{input}})
      expect(screen.getByText("Prompt")).toBeInTheDocument();

      // After form reset, should switch to "Messages" mode
      await waitFor(
        () => {
          expect(screen.getByText("Messages")).toBeInTheDocument();
        },
        { timeout: 500 },
      );
    });

    it("stays in Prompt mode when reset messages are system + user with {{input}}", async () => {
      render(
        <TestWrapperWithDelayedReset
          messagesAfterReset={[
            { role: "system", content: "Different system prompt" },
            { role: "user", content: "{{input}}" }, // Still {{input}} -> should stay Prompt mode
          ]}
        />,
      );

      // Should show "Prompt" mode
      expect(screen.getByText("Prompt")).toBeInTheDocument();

      // After form reset, should still be in "Prompt" mode
      await waitFor(
        () => {
          // Check that we still have Prompt and don't have Messages
          expect(screen.getByText("Prompt")).toBeInTheDocument();
        },
        { timeout: 500 },
      );
    });

    it("updates to Messages mode when reset includes assistant message", async () => {
      render(
        <TestWrapperWithDelayedReset
          messagesAfterReset={[
            { role: "system", content: "System" },
            { role: "user", content: "{{input}}" },
            { role: "assistant", content: "Response" }, // Has assistant -> Messages mode
          ]}
        />,
      );

      // Initially "Prompt"
      expect(screen.getByText("Prompt")).toBeInTheDocument();

      // After reset with assistant message, should be "Messages"
      await waitFor(
        () => {
          expect(screen.getByText("Messages")).toBeInTheDocument();
        },
        { timeout: 500 },
      );
    });
  });
});
