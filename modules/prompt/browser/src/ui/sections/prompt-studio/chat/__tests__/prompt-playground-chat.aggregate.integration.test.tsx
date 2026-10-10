/**
 * @vitest-environment jsdom
 * An aggregate project (ADR-177) holds no key and runs nothing: the notice replaces the chat.
 * @see specs/governance/aggregate-project.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PromptHostProvider } from "../../../../../model/prompt-host.ts";
import { FakePromptHost } from "../../../../../testing.tsx";
import { PromptPlaygroundChatProvider, TabIdProvider } from "../../studio-internals.ts";
import { PromptPlaygroundChat } from "../prompt-playground-chat.tsx";

const { projectRef } = vi.hoisted(() => ({
  projectRef: { current: { id: "proj-1", kind: "application" } },
}));

vi.mock("../../../../../behavior/use-prompt-project.ts", () => ({
  usePromptProject: () => ({ project: projectRef.current, projectId: projectRef.current.id }),
}));

vi.mock("../../../../../behavior/lent-trace.tsx", () => ({
  ConversationThread: () => <div data-testid="conversation-thread" />,
}));

vi.mock("../../../../../behavior/playground/use-prompt-execution.ts", () => ({
  usePromptExecution: () => ({
    messages: [],
    errors: {},
    isRunning: false,
    send: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
    deleteMessage: vi.fn(),
  }),
}));

const renderChat = () =>
  renderWithDesignSystem(
    <PromptHostProvider value={new FakePromptHost()}>
      <PromptPlaygroundChatProvider>
        <TabIdProvider tabId="tab-1">
          <PromptPlaygroundChat formValues={{ version: { configData: { llm: {} } } } as never} />
        </TabIdProvider>
      </PromptPlaygroundChatProvider>
    </PromptHostProvider>,
  );

afterEach(() => {
  cleanup();
});

describe("PromptPlaygroundChat", () => {
  describe("given an aggregate project", () => {
    describe("when the playground opens", () => {
      /** @scenario "The app marks the aggregate and offers no way to add data to it" */
      it("shows the read-only notice and no chat", () => {
        projectRef.current = { id: "agg-1", kind: "aggregate" };

        renderChat();

        expect(screen.getByText("Data can't be added to this project")).toBeTruthy();
        expect(screen.queryByTestId("conversation-thread")).toBeNull();
      });
    });
  });

  describe("given an ordinary project", () => {
    describe("when the playground opens", () => {
      it("shows the chat", () => {
        projectRef.current = { id: "proj-1", kind: "application" };

        renderChat();

        expect(screen.getByTestId("conversation-thread")).toBeTruthy();
      });
    });
  });
});
