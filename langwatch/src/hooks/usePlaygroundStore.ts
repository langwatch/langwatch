import { create } from "zustand";
import { temporal } from "zundo";

interface PlaygroundStore {
  tabs: PlaygroundTabState[];
  currentTabIndex: number;
  addChatWindow: () => void;
}

export interface PlaygroundTabState {
  name: string;
  chatWindows: ChatWindowState[];
}

export interface ChatWindowState {
  model: string;
  messages: Message[];
}

interface Message {
  text: string;
}

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
) => {
  const setCurrentTab = (
    fn: (current: PlaygroundTabState) => Partial<PlaygroundTabState>
  ): void => {
    set((state) => ({
      tabs: state.tabs.map((tab, index) => {
        if (index === state.currentTabIndex) {
          return { ...tab, ...fn(tab) };
        }
        return tab;
      }),
    }));
  };

  return {
    currentTabIndex: 0,
    tabs: [
      {
        name: "Conversation 1",
        chatWindows: [
          {
            model: "gpt-3.5-turbo",
            messages: [
              {
                text: "Hello, world!",
              },
            ],
          },
        ],
      },
    ],
    addChatWindow: () => {
      setCurrentTab((tab) => ({
        chatWindows: [
          ...tab.chatWindows,
          { model: "gpt-3.5-turbo", messages: [] },
        ],
      }));
    },
  };
};

export const usePlaygroundStore = create<PlaygroundStore>()(temporal(store));
