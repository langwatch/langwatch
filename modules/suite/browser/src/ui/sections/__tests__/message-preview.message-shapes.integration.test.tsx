/**
 * MessagePreview component message format tests.
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { ScenarioRunData } from "@langwatch/scenario-contract";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MessagePreview } from "../../elements/runs/message-preview.tsx";

type Messages = ScenarioRunData["messages"];

describe("<MessagePreview/>", () => {
  afterEach(cleanup);

  describe("when messages array is empty", () => {
    it("renders skeleton placeholders", () => {
      const { container } = renderWithDesignSystem(<MessagePreview messages={[]} />);

      // Should render shimmer skeletons, not "No messages" text
      expect(screen.queryByText("No messages")).not.toBeInTheDocument();
      expect(container.querySelectorAll("div").length).toBeGreaterThan(0);
    });
  });

  describe("when message content is a string", () => {
    it("renders the string content directly", () => {
      const messages: Messages = [{ id: "msg_1", role: "user", content: "Hello world" }];

      renderWithDesignSystem(<MessagePreview messages={messages} />);

      expect(screen.getByText("Hello world")).toBeInTheDocument();
    });
  });

  describe("when message content is an array with text objects", () => {
    it("renders text from { type: 'text', text } items", () => {
      const messages: Messages = [
        {
          id: "msg_1",
          role: "assistant",
          content: [
            { type: "text", text: "First part" },
            { type: "text", text: "Second part" },
          ],
        },
      ];

      renderWithDesignSystem(<MessagePreview messages={messages} />);

      expect(screen.getByText("First part Second part")).toBeInTheDocument();
    });
  });

  describe("when message content contains tool calls", () => {
    it("renders tool function name", () => {
      const messages: Messages = [
        {
          id: "msg_1",
          role: "assistant",
          content: "None",
          tool_calls: [{ function: { name: "search_db" } }],
        },
      ];

      renderWithDesignSystem(<MessagePreview messages={messages} />);

      expect(screen.getByText("search_db")).toBeInTheDocument();
    });
  });

  describe("when message content contains tool results", () => {
    it("renders the tool result content", () => {
      const messages: Messages = [
        {
          id: "msg_1",
          role: "tool",
          content: "Result data here",
        },
      ];

      renderWithDesignSystem(<MessagePreview messages={messages} />);

      expect(screen.getByText("Result data here")).toBeInTheDocument();
    });
  });

  describe("when message content is 'None'", () => {
    it("skips the message", () => {
      const messages: Messages = [
        { id: "msg_1", role: "user", content: "None" },
        { id: "msg_2", role: "assistant", content: "Visible" },
      ];

      renderWithDesignSystem(<MessagePreview messages={messages} />);

      expect(screen.queryByText("None")).not.toBeInTheDocument();
      expect(screen.getByText("Visible")).toBeInTheDocument();
    });
  });

  describe("when rendering user vs assistant messages", () => {
    it("aligns user messages to flex-end", () => {
      const messages: Messages = [{ id: "msg_1", role: "user", content: "User message" }];

      const { container } = renderWithDesignSystem(<MessagePreview messages={messages} />);

      const allBoxes = container.querySelectorAll("div");
      const userBox = Array.from(allBoxes).find((el) => {
        const style = window.getComputedStyle(el);
        return style.alignSelf === "flex-end";
      });

      expect(userBox).toBeTruthy();
    });

    it("aligns assistant messages to flex-start", () => {
      const messages: Messages = [{ id: "msg_1", role: "assistant", content: "Bot reply" }];

      const { container } = renderWithDesignSystem(<MessagePreview messages={messages} />);

      const allBoxes = container.querySelectorAll("div");
      const assistantBox = Array.from(allBoxes).find((el) => {
        const style = window.getComputedStyle(el);
        return style.alignSelf === "flex-start";
      });

      expect(assistantBox).toBeTruthy();
    });
  });
});
