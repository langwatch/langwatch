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

interface PlaygroundStore {
  tabs: PlaygroundTabState[];
  activeTabIndex: number;
  syncInputs: boolean;
  selectTab: (tabIndex: number) => void;
  addChatWindow: () => void;
  removeChatWindow: (windowIndex: number) => void;
  addNewTab: () => void;
  closeTab: (tabIndex: number) => void;
  setModel: (windowIndex: number, model: ModelOption) => void;
  toggleSyncInputs: () => void;
  onChangeInput: (windowIndex: number, input: string) => void;
  onSubmit: (windowIndex: number, requestedSubmission: boolean) => void;
  setMessages: (windowIndex: number, messages: Message[]) => void;
}

export interface PlaygroundTabState {
  name: string;
  chatWindows: ChatWindowState[];
}

export interface ChatWindowState {
  model: ModelOption;
  input: string;
  requestedSubmission?: boolean;
  messages: Message[];
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
    model: modelOptions.find((model) => model.value === "openai/gpt-4-turbo")!,
    input: "",
    messages: [],
  },
  {
    model: modelOptions.find(
      (model) => model.value === "groq/llama3-70b-8192"
    )!,
    input: "",
    messages: [],
  },
  {
    model: modelOptions.find(
      (model) => model.value === "claude-3-sonnet-20240229"
    )!,
    input: "",
    messages: [],
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
    fn: (current: PlaygroundTabState) => Partial<PlaygroundTabState>
  ): void => {
    set((state) => ({
      tabs: state.tabs.map((tab, index) => {
        if (index === state.activeTabIndex) {
          return { ...tab, ...fn(tab) };
        }
        return tab;
      }),
    }));
  };

  const setChatWindow = (
    windowIndex: number,
    fn: (current: ChatWindowState) => Partial<ChatWindowState>
  ): void => {
    setCurrentTab((tab) => ({
      chatWindows: tab.chatWindows.map((chatWindow, index) => {
        if (index === windowIndex) {
          return { ...chatWindow, ...fn(chatWindow) };
        }
        return chatWindow;
      }),
    }));
  };

  return {
    activeTabIndex: 0,
    syncInputs: true,
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
      set((state) => ({
        tabs: [
          ...state.tabs,
          {
            name: `Conversation ${state.tabs.length + 1}`,
            chatWindows: initialChatWindows,
          },
        ],
        activeTabIndex: state.tabs.length,
      }));
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
    addChatWindow: () => {
      setCurrentTab((tab) => ({
        chatWindows: [
          ...tab.chatWindows,
          { model: modelOptions[0]!, input: "", messages: [] },
        ],
      }));
    },
    removeChatWindow: (windowIndex) => {
      setCurrentTab((tab) => ({
        chatWindows: tab.chatWindows.filter(
          (_, index) => index !== windowIndex
        ),
      }));
    },
    setModel: (windowIndex, model) => {
      setChatWindow(windowIndex, () => ({ model }));
    },
    toggleSyncInputs: () => {
      set((state) => ({ syncInputs: !state.syncInputs }));
    },
    onChangeInput: (windowIndex, input) => {
      set((state) => {
        return {
          ...state,
          tabs: state.tabs.map((tab, tabIndex) => {
            if (tabIndex === state.activeTabIndex) {
              return {
                ...tab,
                chatWindows: tab.chatWindows.map((chatWindow, index) => {
                  if (index === windowIndex || state.syncInputs) {
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
    onSubmit: (windowIndex, requestedSubmission) => {
      set((state) => {
        return {
          tabs: state.tabs.map((tab, tabIndex) => {
            if (tabIndex === state.activeTabIndex) {
              return {
                ...tab,
                chatWindows: tab.chatWindows.map((chatWindow, index) => {
                  if (
                    index === windowIndex ||
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
    setMessages: (windowIndex, messages) => {
      setChatWindow(windowIndex, () => ({ messages }));
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
