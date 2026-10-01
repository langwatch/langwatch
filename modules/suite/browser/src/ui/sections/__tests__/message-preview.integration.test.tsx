/** @vitest-environment jsdom */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MessagePreview, type SuiteRunMessage } from "../../elements/runs/message-preview.tsx";

describe("MessagePreview", () => {
  afterEach(cleanup);

  it("renders text content and preserves user alignment", () => {
    const messages: SuiteRunMessage[] = [{ id: "message-1", role: "user", content: "Hello world" }];

    const { container } = renderWithDesignSystem(<MessagePreview messages={messages} />);

    expect(screen.getByText("Hello world")).toBeTruthy();
    expect(
      Array.from(container.querySelectorAll("div")).some(
        (element) => window.getComputedStyle(element).alignSelf === "flex-end",
      ),
    ).toBe(true);
  });

  it("extracts multimodal text and tool calls", () => {
    const messages: SuiteRunMessage[] = [
      {
        id: "message-1",
        role: "assistant",
        content: [
          { type: "text", text: "First part" },
          { type: "text", text: "Second part" },
        ],
      },
      {
        id: "message-2",
        role: "assistant",
        content: "None",
        tool_calls: [{ function: { name: "search_db" } }],
      },
    ];

    renderWithDesignSystem(<MessagePreview messages={messages} />);

    expect(screen.getByText("First part Second part")).toBeTruthy();
    expect(screen.getByText("search_db")).toBeTruthy();
  });

  it("renders an empty-state skeleton when no messages are available", () => {
    renderWithDesignSystem(<MessagePreview messages={[]} />);

    expect(screen.queryByText("No messages")).toBeNull();
    expect(document.querySelectorAll("div").length).toBeGreaterThan(0);
  });
});
