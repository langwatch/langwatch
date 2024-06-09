import { create } from "zustand";
import { temporal } from "zundo";
import type { Message } from "ai";
import isDeepEqual from "fast-deep-equal";
import { nanoid } from "nanoid";
import { modelSelectorOptions } from "../components/ModelSelector";

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
  setModel: (windowId: string, model: string) => void;
  toggleSyncInputs: () => void;
  onChangeInput: (windowId: string, input: string) => void;
  onSubmit: (windowId: string, requestedSubmission: boolean) => void;
  setMessages: (windowId: string, messages: Message[]) => void;
  toggleSystemPromptExpanded: (windowId: string) => void;
  onChangeSystemPrompt: (windowId: string, systemPrompt: string) => void;
  toggleSyncSystemPrompts: (currentSystemPrompt: string) => void;
}

export interface PlaygroundTabState {
  name: string;
  chatWindows: ChatWindowState[];
}

export interface ChatWindowState {
  id: string;
  model: string;
  input: string;
  requestedSubmission?: boolean;
  messages: Message[];
  systemPrompt: string;
  systemPromptExpanded: boolean;
}

const initialChatWindows: ChatWindowState[] = [
  {
    id: nanoid(),
    model: "openai/gpt-4o",
    input: "",
    messages: [],
    systemPrompt: "",
    systemPromptExpanded: false,
  },
  {
    id: nanoid(),
    model: "groq/llama3-70b-8192",
    input: "",
    messages: [],
    systemPrompt: "",
    systemPromptExpanded: false,
  },
  {
    id: nanoid(),
    model: "anthropic/claude-3-sonnet-20240229",
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
              model: modelSelectorOptions[0]!.value,
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
      set((state) => {
        const currentExpanded = !!state.tabs[
          state.activeTabIndex
        ]?.chatWindows.find((chatWindow) => chatWindow.id === windowId)
          ?.systemPromptExpanded;

        return {
          tabs: state.tabs.map((tab, tabIndex) => {
            if (tabIndex === state.activeTabIndex) {
              return {
                ...tab,
                chatWindows: tab.chatWindows.map((chatWindow) => {
                  if (chatWindow.id === windowId || state.syncSystemPrompts) {
                    return {
                      ...chatWindow,
                      systemPromptExpanded: !currentExpanded,
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
    onChangeSystemPrompt: (windowId, systemPrompt) => {
      set((state) => {
        return {
          tabs: state.tabs.map((tab, tabIndex) => {
            if (tabIndex === state.activeTabIndex) {
              return {
                ...tab,
                chatWindows: tab.chatWindows.map((chatWindow) => {
                  if (chatWindow.id === windowId || state.syncSystemPrompts) {
                    return { ...chatWindow, systemPrompt };
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
    toggleSyncSystemPrompts: (currentSystemPrompt: string) => {
      set((state) => {
        if (!state.syncSystemPrompts) {
          return {
            syncSystemPrompts: true,
            tabs: state.tabs.map((tab) => {
              return {
                ...tab,
                chatWindows: tab.chatWindows.map((chatWindow) => ({
                  ...chatWindow,
                  systemPromptExpanded: true,
                  systemPrompt: currentSystemPrompt,
                })),
              };
            }),
          };
        }
        return { syncSystemPrompts: false };
      });
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
