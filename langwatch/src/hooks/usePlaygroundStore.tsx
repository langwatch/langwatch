import { create } from "zustand";
import { temporal } from "zundo";
import { Anthropic } from "../components/icons/Anthropic";
import { Azure } from "../components/icons/Azure";
import { Meta } from "../components/icons/Meta";
import { Mistral } from "../components/icons/Mistral";
import { OpenAI } from "../components/icons/OpenAI";
import models from "../../../models.json";
import type { Message } from "ai";
import isDeepEqual from "fast-deep-equal";
import { nanoid } from "nanoid";

interface PlaygroundStore {
  tabs: PlaygroundTabState[];
  activeTabIndex: number;
  syncInputs: boolean;
  syncSystemPrompts: boolean;
  selectTab: (tabIndex: number) => void;
  addChatWindow: (windowId: string) => void;
  removeChatWindow: (windowId: string) => void;
  reorderChatWindows: (idsOrder: string[]) => void;
  addNewTab: () => void;
  closeTab: (tabIndex: number) => void;
  setModel: (windowId: string, model: ModelOption) => void;
  toggleSyncInputs: () => void;
  onChangeInput: (windowId: string, input: string) => void;
  onSubmit: (windowId: string, requestedSubmission: boolean) => void;
  setMessages: (windowId: string, messages: Message[]) => void;
  toggleSystemPromptExpanded: (windowId: string) => void;
  onChangeSystemPrompt: (windowId: string, systemPrompt: string) => void;
}

export interface PlaygroundTabState {
  name: string;
  chatWindows: ChatWindowState[];
}

export interface ChatWindowState {
  id: string;
  model: ModelOption;
  input: string;
  requestedSubmission?: boolean;
  messages: Message[];
  systemPrompt: string;
  systemPromptExpanded: boolean;
}

type ModelOption = {
  label: string;
  value: string;
  version: string;
  icon: React.ReactNode;
};

const providerIcons: Record<string, React.ReactNode> = {
  azure: <Azure />,
  openai: <OpenAI />,
  meta: <Meta />,
  mistral: <Mistral />,
  anthropic: <Anthropic />,
};

export const modelOptions: ModelOption[] = Object.entries(models).map(
  ([key, value]) => ({
    label: value.name,
    value: key,
    version: value.version,
    icon: providerIcons[value.model_provider],
  })
);

const initialChatWindows: ChatWindowState[] = [
  {
    id: nanoid(),
    model: modelOptions.find((model) => model.value === "openai/gpt-4-turbo")!,
    input: "",
    messages: [],
    systemPrompt: "",
    systemPromptExpanded: false,
  },
  {
    id: nanoid(),
    model: modelOptions.find(
      (model) => model.value === "groq/llama3-70b-8192"
    )!,
    input: "",
    messages: [],
    systemPrompt: "",
    systemPromptExpanded: false,
  },
  {
    id: nanoid(),
    model: modelOptions.find(
      (model) => model.value === "claude-3-sonnet-20240229"
    )!,
    input: "",
    messages: [],
    systemPrompt: "",
    systemPromptExpanded: false,
  },
];

const store = (
  set: (
    partial:
      | PlaygroundStore
      | Partial<PlaygroundStore>
      | ((
          state: PlaygroundStore
        ) => PlaygroundStore | Partial<PlaygroundStore>),
    replace?: boolean | undefined
  ) => void
): PlaygroundStore => {
  const setCurrentTab = (
    fn: (
      current: PlaygroundTabState,
      state: PlaygroundStore
    ) => Partial<PlaygroundTabState>
  ): void => {
    set((state) => ({
      tabs: state.tabs.map((tab, index) => {
        if (index === state.activeTabIndex) {
          return { ...tab, ...fn(tab, state) };
        }
        return tab;
      }),
    }));
  };

  const setChatWindow = (
    windowId: string,
    fn: (current: ChatWindowState) => Partial<ChatWindowState>
  ): void => {
    setCurrentTab((tab) => ({
      chatWindows: tab.chatWindows.map((chatWindow) => {
        if (chatWindow.id === windowId) {
          return { ...chatWindow, ...fn(chatWindow) };
        }
        return chatWindow;
      }),
    }));
  };

  return {
    activeTabIndex: 0,
    syncInputs: true,
    syncSystemPrompts: true,
    tabs: [
      {
        name: "Conversation 1",
        chatWindows: initialChatWindows,
      },
    ],
    selectTab: (index) => {
      set({ activeTabIndex: index });
    },
    addNewTab: () => {
      set((state) => {
        const currentTab = state.tabs[state.activeTabIndex] ?? {
          name: "Conversation 1",
          chatWindows: initialChatWindows,
        };
        return {
          tabs: [
            ...state.tabs,
            {
              ...currentTab,
              name: `Conversation ${state.tabs.length + 1}`,
              chatWindows: currentTab.chatWindows.map((chatWindow) => ({
                ...chatWindow,
                id: nanoid(),
                messages: [],
              })),
            },
          ],
          activeTabIndex: state.tabs.length,
        };
      });
    },
    closeTab: (index) => {
      set((state) => {
        const newTabs = [...state.tabs];
        newTabs.splice(index, 1);
        return {
          tabs: newTabs,
          activeTabIndex: Math.min(state.activeTabIndex, newTabs.length - 1),
        };
      });
    },
    addChatWindow: (windowId) => {
      setCurrentTab((tab, _state) => {
        const currentChatWindowIndex = Math.max(
          tab.chatWindows.findIndex((chatWindow) => chatWindow.id === windowId),
          0
        );
        return {
          chatWindows: [
            ...tab.chatWindows.slice(0, currentChatWindowIndex + 1),
            {
              id: nanoid(),
              model: modelOptions[0]!,
              input: "",
              messages: [],
              // TODO: get from others if in sync
              systemPrompt: "",
              systemPromptExpanded: false,
            },
            ...tab.chatWindows.slice(currentChatWindowIndex + 1),
          ],
        };
      });
    },
    removeChatWindow: (windowId) => {
      setCurrentTab((tab) => ({
        chatWindows: tab.chatWindows.filter(
          (chatWindow) => chatWindow.id !== windowId
        ),
      }));
    },
    reorderChatWindows: (idsOrder) => {
      setCurrentTab((tab) => ({
        chatWindows: idsOrder.map(
          (id) => tab.chatWindows.find((chatWindow) => chatWindow.id === id)!
        ),
      }));
    },
    setModel: (windowId, model) => {
      setChatWindow(windowId, () => ({ model }));
    },
    toggleSyncInputs: () => {
      set((state) => ({ syncInputs: !state.syncInputs }));
    },
    onChangeInput: (windowId, input) => {
      set((state) => {
        return {
          ...state,
          tabs: state.tabs.map((tab, tabIndex) => {
            if (tabIndex === state.activeTabIndex) {
              return {
                ...tab,
                chatWindows: tab.chatWindows.map((chatWindow) => {
                  if (chatWindow.id === windowId || state.syncInputs) {
                    return { ...chatWindow, input };
                  }
                  return chatWindow;
                }),
              };
            }
            return tab;
          }),
        };
      });
    },
    onSubmit: (windowId, requestedSubmission) => {
      set((state) => {
        return {
          tabs: state.tabs.map((tab, tabIndex) => {
            if (tabIndex === state.activeTabIndex) {
              return {
                ...tab,
                chatWindows: tab.chatWindows.map((chatWindow) => {
                  if (
                    chatWindow.id === windowId ||
                    (requestedSubmission && state.syncInputs)
                  ) {
                    return {
                      ...chatWindow,
                      requestedSubmission,
                      ...(requestedSubmission ? { input: "" } : {}),
                    };
                  }
                  return chatWindow;
                }),
              };
            }
            return tab;
          }),
        };
      });
    },
    setMessages: (windowId, messages) => {
      setChatWindow(windowId, () => ({ messages }));
    },
    toggleSystemPromptExpanded: (windowId) => {
      setChatWindow(windowId, (chatWindow) => ({
        systemPromptExpanded: !chatWindow.systemPromptExpanded,
      }));
    },
    onChangeSystemPrompt: (windowId, systemPrompt) => {
      setChatWindow(windowId, ({ messages }) => ({
        systemPrompt,
      }));
    },
  };
};

export const usePlaygroundStore = create<PlaygroundStore>()(
  temporal(store, {
    partialize: (state) => {
      const state_ = {
        ...state,
        tabs: state.tabs.map((tab) => {
          const tab_ = { ...tab };
          tab_.chatWindows = tab_.chatWindows.map((chatWindow) => {
            const chatWindow_ = { ...chatWindow };
            delete chatWindow_.requestedSubmission;
            return chatWindow_;
          });
          return tab_;
        }),
      };

      return state_;
    },
    equality: (pastState, currentState) => isDeepEqual(pastState, currentState),
  })
);
