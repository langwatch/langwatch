/**
 * @vitest-environment jsdom
 *
 * Integration tests verifying ThinkingIndicator is shown/hidden
 * based on scenario run status within the drawer conversation area.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";

// Mock CopilotKit chat to avoid pulling in Prisma and other heavy deps
vi.mock("../CustomCopilotKitChat", () => ({
  CustomCopilotKitChat: () => <div data-testid="mock-chat">chat</div>,
}));

import { ConversationArea } from "../ConversationArea";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("ConversationArea", () => {
  afterEach(cleanup);

  describe("when status is IN_PROGRESS with no messages", () => {
    it("renders the thinking indicator", () => {
      render(
        <ConversationArea
          messages={[]}
          status={ScenarioRunStatus.IN_PROGRESS}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByRole("status")).toBeInTheDocument();
    });
  });

  describe("when status is PENDING with no messages", () => {
    it("renders the thinking indicator", () => {
      render(
        <ConversationArea
          messages={[]}
          status={ScenarioRunStatus.PENDING}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByRole("status")).toBeInTheDocument();
    });
  });

  describe("when status is SUCCESS", () => {
    it("does not render the thinking indicator", () => {
      render(
        <ConversationArea
          messages={[]}
          status={ScenarioRunStatus.SUCCESS}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("does not render the conversation area when there are no messages", () => {
      const { container } = render(
        <ConversationArea
          messages={[]}
          status={ScenarioRunStatus.SUCCESS}
        />,
        { wrapper: Wrapper },
      );

      expect(container.firstChild).toBeNull();
    });
  });

  describe("when status is FAILED", () => {
    it("does not render the thinking indicator", () => {
      render(
        <ConversationArea
          messages={[]}
          status={ScenarioRunStatus.FAILED}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });
});
