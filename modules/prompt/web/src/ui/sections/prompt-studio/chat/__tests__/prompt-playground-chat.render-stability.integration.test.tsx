/**
 * @vitest-environment jsdom
 *
 * The chat reads only its own tab's slice of the tab store, so a change to
 * something it did not select must not re-render it.
 *
 * @see specs/prompts/studio-render-stability.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PromptHostProvider } from "../../../../../model/prompt-host.ts";
import { FakePromptHost } from "../../../../../testing.tsx";
import {
  clearStoreInstances,
  getStoreForTesting,
  PromptPlaygroundChatProvider,
  type PromptTabsCapabilities,
  TabIdProvider,
  type TabData,
} from "../../studio-internals.ts";
import { PromptPlaygroundChat } from "../prompt-playground-chat.tsx";

const TEST_PROJECT_ID = "test-project";

const { renderCount } = vi.hoisted(() => ({ renderCount: { value: 0 } }));

vi.mock("../../../../../behavior/use-prompt-project.ts", () => ({
  usePromptProject: () => ({
    project: { id: TEST_PROJECT_ID },
    projectId: TEST_PROJECT_ID,
  }),
}));

// The thread itself is covered by the shared renderer's own suite; here it is
// only a render counter, because a re-render of the chat is a re-render of it.
vi.mock("@langwatch/trace-web/surfaces/conversation", () => ({
  ConversationThread: () => {
    renderCount.value += 1;
    return <div data-testid="conversation-thread" />;
  },
  flattenMessages: () => [],
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
    setMessages: vi.fn(),
  }),
}));

const memoryStorage = (() => {
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
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
})();

const capabilities: PromptTabsCapabilities = {
  storage: memoryStorage,
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
};

const createTabData = (): TabData => ({
  chat: { initialMessagesFromSpanData: [] },
  form: { currentValues: {} },
  meta: { title: null, versionNumber: undefined, scope: undefined },
  variableValues: {},
});

const testHost = new FakePromptHost();

describe("<PromptPlaygroundChat/> render stability", () => {
  let store: ReturnType<typeof getStoreForTesting>;

  beforeEach(() => {
    renderCount.value = 0;
    memoryStorage.clear();
    clearStoreInstances();
    store = getStoreForTesting({ projectId: TEST_PROJECT_ID, capabilities });
  });

  afterEach(() => {
    cleanup();
    clearStoreInstances();
  });

  describe("when the store updates something the chat did not select", () => {
    /** @scenario "The prompt playground chat stays put on an unrelated store update" */
    it("does not re-render on an unrelated store update", () => {
      store.getState().addTab({ data: createTabData() });
      const tabId = store.getState().windows[0]?.tabs[0]?.id;
      expect(tabId).toBeDefined();

      render(
        <ChakraProvider value={defaultSystem}>
          <PromptHostProvider value={testHost}>
            <PromptPlaygroundChatProvider>
              <TabIdProvider tabId={tabId!}>
                <PromptPlaygroundChat
                  formValues={{ version: { configData: { llm: {} } } } as never}
                />
              </TabIdProvider>
            </PromptPlaygroundChatProvider>
          </PromptHostProvider>
        </ChakraProvider>,
      );

      expect(renderCount.value).toBe(1);

      // Opening a second tab changes `windows`/`activeTab`, neither of which
      // this component selects, so it must not re-render.
      act(() => {
        store.getState().addTab({ data: createTabData() });
      });

      expect(renderCount.value).toBe(1);
    });
  });
});
