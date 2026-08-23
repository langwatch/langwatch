/**
 * @vitest-environment jsdom
 *
 * The prompt's variables, shown on the message box so a run can be set up
 * without leaving the conversation.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
      const field = await screen.findByTestId("chat-variable-input-topic");

      // A change event carrying the whole value, not `user.type`. The field is
      // controlled and this test never feeds the new value back, so typing
      // character by character reported the same single character each time,
      // and asserting the first call would have held even if only the first
      // keystroke arrived. None of them did: the popover's content is not
      // focusable under jsdom, so every keystroke went nowhere and the
      // assertion this replaces was failing. What the contract actually says
      // is that the field reports what it now holds, for its own variable.
      fireEvent.change(field, { target: { value: "otters" } });

      expect(onValueChange).toHaveBeenCalledTimes(1);
      expect(onValueChange).toHaveBeenCalledWith("topic", "otters");
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
      // The empty chip shows its name and nothing else. Asserting the absence
      // of "=" proved nothing — no chip renders one in any state — so this
      // asserts the thing that actually separates the two: the set chip's text
      // carries its value beyond the name, and the bare one's does not.
      const bare = screen.getByTestId("chat-variable-tone");
      expect(bare).toHaveTextContent("tone");
      expect(bare.textContent?.replace("tone", "").trim()).toBe("");
    });
  });

  describe("when the prompt declares no variables", () => {
    it("takes no room on the message box", () => {
      renderFields([]);

      expect(screen.queryByText("Variables")).not.toBeInTheDocument();
    });
  });
});
