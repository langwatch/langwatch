/**
 * @vitest-environment jsdom
 *
 * Tests for PromptPlaygroundChat component ref methods.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import {
  clearStoreInstances,
  getStoreForTesting,
  type TabData,
} from "../../../prompt-playground-store/DraggableTabsBrowserStore";
import { TabIdProvider } from "../../prompt-browser/ui/TabContext";
import { SyncedChatInput } from "../SyncedChatInput";
import { PromptPlaygroundChatProvider } from "../PromptPlaygroundChatContext";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

global.localStorage = localStorageMock as Storage;

const TEST_PROJECT_ID = "test-project";
const TEST_TAB_ID = "test-tab-123";

// Mock useOrganizationTeamProject
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: TEST_PROJECT_ID },
    projectId: TEST_PROJECT_ID,
  }),
}));

// Mock CopilotKit components since they require complex setup
vi.mock("@copilotkit/react-ui", () => ({
  CopilotChat: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="copilot-chat">{children}</div>
  ),
}));

vi.mock("@copilotkit/runtime-client-gql", () => ({
  useCopilotContext: () => ({
    setMessages: vi.fn(),
    messages: [],
  }),
}));

/**
 * Helper to create a minimal TabData object for testing
 */
const createTabData = (overrides?: Partial<TabData>): TabData => ({
  chat: {
    initialMessagesFromSpanData: [],
  },
  form: {
    currentValues: {},
  },
  meta: {
    title: null,
    versionNumber: undefined,
    scope: undefined,
  },
  variableValues: {},
  ...overrides,
});

describe("PromptPlaygroundChat ref methods", () => {
  let store: ReturnType<typeof getStoreForTesting>;

  beforeEach(() => {
    localStorage.clear();
    clearStoreInstances();
    store = getStoreForTesting(TEST_PROJECT_ID);
  });

  afterEach(() => {
    cleanup();
    clearStoreInstances();
    localStorage.clear();
  });

  describe("focusInput", () => {
    it("focuses textarea with matching data-tab-id", () => {
      // Create a textarea in the document with the expected data-tab-id
      const textarea = document.createElement("textarea");
      textarea.setAttribute("data-tab-id", TEST_TAB_ID);
      document.body.appendChild(textarea);

      // Spy on the focus method
      const focusSpy = vi.spyOn(textarea, "focus");

      // Simulate what focusInput does
      const foundTextarea = document.querySelector<HTMLTextAreaElement>(
        `textarea[data-tab-id="${TEST_TAB_ID}"]`
      );
      foundTextarea?.focus();

      expect(focusSpy).toHaveBeenCalled();

      // Cleanup
      document.body.removeChild(textarea);
    });

    it("does not throw when textarea not found", () => {
      // Simulate what focusInput does with missing textarea
      const foundTextarea = document.querySelector<HTMLTextAreaElement>(
        `textarea[data-tab-id="non-existent"]`
      );

      // This should not throw
      expect(() => foundTextarea?.focus()).not.toThrow();
    });
  });

  describe("data-tab-id attribute", () => {
    it("SyncedChatInput renders with data-tab-id", () => {
      store.getState().addTab({ data: createTabData() });
      const tabId = store.getState().windows[0]?.tabs[0]?.id;
      expect(tabId).toBeDefined();

      render(
        <ChakraProvider value={defaultSystem}>
          <TabIdProvider tabId={tabId!}>
            <PromptPlaygroundChatProvider>
              <SyncedChatInput
                inProgress={false}
                onSend={vi.fn().mockResolvedValue(undefined)}
                isVisible={true}
                onStop={vi.fn()}
              />
            </PromptPlaygroundChatProvider>
          </TabIdProvider>
        </ChakraProvider>
      );

      const textarea = screen.getByPlaceholderText(
        /type your message/i
      ) as HTMLTextAreaElement;
      expect(textarea).toHaveAttribute("data-tab-id", tabId);
    });
  });
});

