/**
 * @vitest-environment jsdom
 *
 * The playground chat posts to the chat endpoint with the project's own key.
 * An aggregate project (ADR-144) holds no key and runs nothing, so it shows
 * the read-only notice in place of the chat and never mounts the client that
 * would send the request.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PromptConfigFormValues } from "~/prompts/types";
import { TabIdProvider } from "../../prompt-browser/ui/TabContext";
import { PromptPlaygroundChat } from "../PromptPlaygroundChat";

const { projectRef, copilotMounts } = vi.hoisted(() => ({
  projectRef: {
    current: { id: "proj-1", kind: "application", apiKey: "sk-test" } as {
      id: string;
      kind: string;
      apiKey: string | null;
    },
  },
  copilotMounts: { count: 0 },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: projectRef.current,
    projectId: projectRef.current.id,
  }),
}));

vi.mock("@copilotkit/react-core", () => ({
  CopilotKit: ({ children }: { children: ReactNode }) => {
    copilotMounts.count += 1;
    return <div data-testid="copilot-kit">{children}</div>;
  },
  useCopilotChat: () => ({ setMessages: vi.fn(), visibleMessages: [] }),
}));

vi.mock("@copilotkit/react-ui", () => ({
  CopilotChat: () => <div data-testid="copilot-chat" />,
  AssistantMessage: () => null,
  UserMessage: () => null,
}));

vi.mock("~/components/copilot-kit/TraceMessage", () => ({
  TraceMessage: () => null,
}));

const renderChat = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <TabIdProvider tabId="tab-1">
        <PromptPlaygroundChat
          formValues={{} as PromptConfigFormValues}
          variables={[]}
        />
      </TabIdProvider>
    </ChakraProvider>,
  );

afterEach(() => {
  cleanup();
  copilotMounts.count = 0;
});

describe("PromptPlaygroundChat", () => {
  describe("given an aggregate project", () => {
    describe("when the playground opens", () => {
      /** @scenario "The app marks the aggregate and offers no way to add data to it" */
      it("shows the read-only notice and mounts no chat client", () => {
        projectRef.current = { id: "agg-1", kind: "aggregate", apiKey: null };

        renderChat();

        expect(
          screen.getByText("Data can't be added to this project"),
        ).toBeTruthy();
        expect(screen.queryByTestId("copilot-kit")).toBeNull();
        expect(copilotMounts.count).toBe(0);
      });
    });
  });

  describe("given an ordinary project", () => {
    describe("when the playground opens", () => {
      it("mounts the chat client", () => {
        projectRef.current = {
          id: "proj-1",
          kind: "application",
          apiKey: "sk-test",
        };

        renderChat();

        expect(screen.getByTestId("copilot-kit")).toBeTruthy();
      });
    });
  });
});
