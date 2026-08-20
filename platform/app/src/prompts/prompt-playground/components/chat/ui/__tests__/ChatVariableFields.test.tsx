/**
 * @vitest-environment jsdom
 *
 * The prompt's variables, shown on the message box so a run can be set up
 * without leaving the conversation.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ChatVariableField,
  ChatVariableFields,
} from "../ChatVariableFields";

const renderFields = (
  variables: ChatVariableField[],
  onValueChange = vi.fn(),
) => {
  const result = render(
    <ChakraProvider value={defaultSystem}>
      <ChatVariableFields variables={variables} onValueChange={onValueChange} />
    </ChakraProvider>,
  );
  return { ...result, onValueChange };
};

describe("the variables on the message box", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when the prompt declares variables", () => {
    /** @scenario The prompt's variables are visible on the message box */
    it("names every one of them", () => {
      renderFields([
        { identifier: "topic", value: "" },
        { identifier: "tone", value: "" },
      ]);

      expect(screen.getByTestId("chat-variable-topic")).toBeInTheDocument();
      expect(screen.getByTestId("chat-variable-tone")).toBeInTheDocument();
    });

    /** @scenario The prompt's variables are visible on the message box */
    it("sets one without leaving the conversation", async () => {
      const user = userEvent.setup();
      const { onValueChange } = renderFields([
        { identifier: "topic", value: "" },
      ]);

      await user.click(screen.getByTestId("chat-variable-topic"));
      await user.type(
        await screen.findByTestId("chat-variable-input-topic"),
        "otters",
      );

      expect(onValueChange).toHaveBeenCalledWith("topic", "o");
    });

    /** @scenario A variable with no value yet stands out from one already set */
    it("shows what a set variable holds and leaves an empty one bare", () => {
      renderFields([
        { identifier: "topic", value: "otters" },
        { identifier: "tone", value: "" },
      ]);

      expect(screen.getByTestId("chat-variable-topic")).toHaveTextContent(
        "otters",
      );
      expect(screen.getByTestId("chat-variable-tone")).toHaveTextContent(
        "tone",
      );
      expect(screen.getByTestId("chat-variable-tone")).not.toHaveTextContent(
        "=",
      );
    });
  });

  describe("when the prompt declares no variables", () => {
    it("takes no room on the message box", () => {
      renderFields([]);

      expect(screen.queryByText("Variables")).not.toBeInTheDocument();
    });
  });
});
