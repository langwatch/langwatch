/**
 * @vitest-environment jsdom
 *
 * Unit tests for MessagePreview component.
 *
 * Tests content extraction from various message formats:
 * string, array with text objects, tool_use, tool_result,
 * and message alignment based on role.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { MessagePreview } from "../MessagePreview";

type Messages = ScenarioRunData["messages"];

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<MessagePreview/>", () => {
  afterEach(cleanup);

  describe("when messages array is empty", () => {
    it("renders 'No messages' text", () => {
      render(<MessagePreview messages={[]} />, { wrapper: Wrapper });

      expect(screen.getByText("No messages")).toBeInTheDocument();
    });
  });

  describe("when message content is a string", () => {
    it("renders the string content directly", () => {
      const messages = [
        { id: "msg_1", role: "user", content: "Hello world" },
      ] as unknown as Messages;

      render(<MessagePreview messages={messages} />, { wrapper: Wrapper });

      expect(screen.getByText("Hello world")).toBeInTheDocument();
    });
  });

  describe("when message content is an array with text objects", () => {
    it("renders text from { text } items", () => {
      const messages = [
        {
          id: "msg_1",
          role: "assistant",
          content: [{ text: "First part" }, { text: "Second part" }],
        },
      ] as unknown as Messages;

      render(<MessagePreview messages={messages} />, { wrapper: Wrapper });

      expect(
        screen.getByText("First part Second part"),
      ).toBeInTheDocument();
    });
  });

  describe("when message content contains tool_use items", () => {
    it("renders [Tool: name] for tool_use entries", () => {
      const messages = [
        {
          id: "msg_1",
          role: "assistant",
          content: [{ type: "tool_use", name: "search_db" }],
        },
      ] as unknown as Messages;

      render(<MessagePreview messages={messages} />, { wrapper: Wrapper });

      expect(screen.getByText("[Tool: search_db]")).toBeInTheDocument();
    });
  });

  describe("when message content contains tool_result items", () => {
    it("renders [Tool result] for tool_result entries", () => {
      const messages = [
        {
          id: "msg_1",
          role: "assistant",
          content: [{ type: "tool_result" }],
        },
      ] as unknown as Messages;

      render(<MessagePreview messages={messages} />, { wrapper: Wrapper });

      expect(screen.getByText("[Tool result]")).toBeInTheDocument();
    });
  });

  describe("when message content is 'None'", () => {
    it("skips the message", () => {
      const messages = [
        { id: "msg_1", role: "user", content: "None" },
        { id: "msg_2", role: "assistant", content: "Visible" },
      ] as unknown as Messages;

      render(<MessagePreview messages={messages} />, { wrapper: Wrapper });

      expect(screen.queryByText("None")).not.toBeInTheDocument();
      expect(screen.getByText("Visible")).toBeInTheDocument();
    });
  });

  describe("when rendering user vs assistant messages", () => {
    it("aligns user messages to flex-end", () => {
      const messages = [
        { id: "msg_1", role: "user", content: "User message" },
      ] as unknown as Messages;

      const { container } = render(<MessagePreview messages={messages} />, {
        wrapper: Wrapper,
      });

      const allBoxes = container.querySelectorAll("div");
      const userBox = Array.from(allBoxes).find((el) => {
        const style = window.getComputedStyle(el);
        return style.alignSelf === "flex-end";
      });

      expect(userBox).toBeTruthy();
    });

    it("aligns assistant messages to flex-start", () => {
      const messages = [
        { id: "msg_1", role: "assistant", content: "Bot reply" },
      ] as unknown as Messages;

      const { container } = render(<MessagePreview messages={messages} />, {
        wrapper: Wrapper,
      });

      const allBoxes = container.querySelectorAll("div");
      const assistantBox = Array.from(allBoxes).find((el) => {
        const style = window.getComputedStyle(el);
        return style.alignSelf === "flex-start";
      });

      expect(assistantBox).toBeTruthy();
    });
  });
});
