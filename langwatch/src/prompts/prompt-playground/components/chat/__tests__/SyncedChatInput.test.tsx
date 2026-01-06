/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearStoreInstances,
  getStoreForTesting,
  type TabData,
} from "../../../prompt-playground-store/DraggableTabsBrowserStore";
import { TabIdProvider } from "../../prompt-browser/ui/TabContext";
import { PromptPlaygroundChatProvider } from "../PromptPlaygroundChatContext";
import { SyncedChatInput } from "../SyncedChatInput";

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

// Mock useOrganizationTeamProject
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: TEST_PROJECT_ID },
    projectId: TEST_PROJECT_ID,
  }),
}));

const TEST_PROJECT_ID = "test-project";

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

type RenderOptions = {
  tabId: string;
  inProgress?: boolean;
};

const renderSyncedChatInput = ({
  tabId,
  inProgress = false,
}: RenderOptions) => {
  const onSend = vi.fn().mockResolvedValue(undefined);
  const onStop = vi.fn();

  return {
    ...render(
      <ChakraProvider value={defaultSystem}>
        <TabIdProvider tabId={tabId}>
          <PromptPlaygroundChatProvider>
            <SyncedChatInput
              inProgress={inProgress}
              onSend={onSend}
              isVisible={true}
              onStop={onStop}
            />
          </PromptPlaygroundChatProvider>
        </TabIdProvider>
      </ChakraProvider>,
    ),
    onSend,
    onStop,
  };
};

describe("SyncedChatInput", () => {
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

  describe("sync checkbox visibility", () => {
    it("hides sync checkbox when only one tab exists", () => {
      // Add single tab
      store.getState().addTab({ data: createTabData() });
      const tabId = store.getState().windows[0]?.tabs[0]?.id;
      expect(tabId).toBeDefined();

      renderSyncedChatInput({ tabId: tabId! });

      // Sync checkbox should not be in the document
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    });

    it("shows sync checkbox when multiple tabs exist", () => {
      // Add two tabs
      store.getState().addTab({ data: createTabData() });
      store.getState().addTab({ data: createTabData() });

      const tabId = store.getState().windows[0]?.tabs[0]?.id;
      expect(tabId).toBeDefined();

      renderSyncedChatInput({ tabId: tabId! });

      // Sync checkbox should be in the document (though hidden until hover)
      expect(screen.getByRole("checkbox")).toBeInTheDocument();
    });

    it("shows sync checkbox when tabs are split across windows", () => {
      // Add tab and split it
      store.getState().addTab({ data: createTabData() });
      const tabId = store.getState().windows[0]?.tabs[0]?.id;
      expect(tabId).toBeDefined();
      store.getState().splitTab({ tabId: tabId! });

      // Now we have 2 tabs in 2 windows
      expect(store.getState().windows).toHaveLength(2);

      renderSyncedChatInput({ tabId: tabId! });

      expect(screen.getByRole("checkbox")).toBeInTheDocument();
    });
  });

  describe("textarea", () => {
    it("renders textarea with placeholder", () => {
      store.getState().addTab({ data: createTabData() });
      const tabId = store.getState().windows[0]?.tabs[0]?.id;

      renderSyncedChatInput({ tabId: tabId! });

      expect(
        screen.getByPlaceholderText(/type your message/i),
      ).toBeInTheDocument();
    });

    it("keeps textarea enabled when inProgress to allow typing next message", () => {
      store.getState().addTab({ data: createTabData() });
      const tabId = store.getState().windows[0]?.tabs[0]?.id;

      renderSyncedChatInput({ tabId: tabId!, inProgress: true });

      const textarea = screen.getByPlaceholderText(/type your message/i);
      // Textarea should remain enabled during AI response so user can type their next message
      expect(textarea).not.toBeDisabled();
    });

    it("includes data-tab-id attribute for focus targeting", () => {
      store.getState().addTab({ data: createTabData() });
      const tabId = store.getState().windows[0]?.tabs[0]?.id;

      renderSyncedChatInput({ tabId: tabId! });

      const textarea = screen.getByPlaceholderText(/type your message/i);
      expect(textarea).toHaveAttribute("data-tab-id", tabId);
    });
  });

  describe("send button", () => {
    it("renders send button", () => {
      store.getState().addTab({ data: createTabData() });
      const tabId = store.getState().windows[0]?.tabs[0]?.id;

      renderSyncedChatInput({ tabId: tabId! });

      // Button has an icon, find by role
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(0);
    });

    it("disables send button when inProgress", () => {
      store.getState().addTab({ data: createTabData() });
      const tabId = store.getState().windows[0]?.tabs[0]?.id;

      renderSyncedChatInput({ tabId: tabId!, inProgress: true });

      // Find the button (there's only one button when no checkbox)
      const buttons = screen.getAllByRole("button");
      const sendButton = buttons.find(
        (btn) => btn.getAttribute("type") === "button",
      );
      expect(sendButton).toBeDisabled();
    });
  });
});
