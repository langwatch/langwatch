/**
 * @vitest-environment jsdom
 *
 * Unit tests for MessagePreview component.
 *
 * Tests content extraction from various message formats:
 * string, array with text objects, tool calls, tool results,
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
    it("renders skeleton placeholders", () => {
      const { container } = render(<MessagePreview messages={[]} />, { wrapper: Wrapper });

      // Should render shimmer skeletons, not "No messages" text
      expect(screen.queryByText("No messages")).not.toBeInTheDocument();
      expect(container.querySelectorAll("div").length).toBeGreaterThan(0);
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
    it("renders text from { type: 'text', text } items", () => {
      const messages = [
        {
          id: "msg_1",
          role: "assistant",
          content: [{ type: "text", text: "First part" }, { type: "text", text: "Second part" }],
        },
      ] as unknown as Messages;

      render(<MessagePreview messages={messages} />, { wrapper: Wrapper });

      expect(
        screen.getByText("First part Second part"),
      ).toBeInTheDocument();
    });
  });

  describe("when message content contains tool calls", () => {
    it("renders tool function name", () => {
      const messages = [
        {
          id: "msg_1",
          role: "assistant",
          content: "None",
          tool_calls: [{ function: { name: "search_db" } }],
        },
      ] as unknown as Messages;

      render(<MessagePreview messages={messages} />, { wrapper: Wrapper });

      expect(screen.getByText("search_db")).toBeInTheDocument();
    });
  });

  describe("when message content contains tool results", () => {
    it("renders the tool result content", () => {
      const messages = [
        {
          id: "msg_1",
          role: "tool",
          content: "Result data here",
        },
      ] as unknown as Messages;

      render(<MessagePreview messages={messages} />, { wrapper: Wrapper });

      expect(screen.getByText("Result data here")).toBeInTheDocument();
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
