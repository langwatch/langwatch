import { describe, expect, it } from "vitest";
import type {
  TabData,
  Window,
} from "../../../prompt-playground-store/DraggableTabsBrowserStore";
import { activePromptId } from "../activePromptId";

const tabFor = (configId: string): { id: string; data: TabData } => ({
  id: `tab-${configId}`,
  data: {
    chat: { initialMessagesFromSpanData: [] },
    form: { currentValues: { configId } },
    meta: { title: configId, versionNumber: 1 },
    variableValues: {},
  } as TabData,
});

const windowWith = ({
  id,
  configIds,
  showing,
}: {
  id: string;
  configIds: string[];
  showing: string;
}): Window => ({
  id,
  tabs: configIds.map(tabFor),
  activeTabId: `tab-${showing}`,
});

describe("activePromptId", () => {
  describe("given several prompts open in one pane", () => {
    /** @scenario The prompts list marks the prompt the workspace is showing */
    it("names only the prompt on screen", () => {
      const windows = [
        windowWith({
          id: "w1",
          configIds: ["search-agent", "summariser"],
          showing: "summariser",
        }),
      ];

      expect(activePromptId({ windows, activeWindowId: "w1" })).toBe(
        "summariser",
      );
    });
  });

  describe("given nothing is open", () => {
    /** @scenario The prompts list marks nothing when no prompt is open */
    it("names no prompt", () => {
      expect(activePromptId({ windows: [], activeWindowId: null })).toBeNull();
    });
  });

  describe("given the workspace is split across two panes", () => {
    const windows = [
      windowWith({
        id: "left",
        configIds: ["search-agent"],
        showing: "search-agent",
      }),
      windowWith({
        id: "right",
        configIds: ["summariser"],
        showing: "summariser",
      }),
    ];

    /** @scenario The prompts list follows the pane the user is working in */
    it("names the prompt in the pane being worked in", () => {
      expect(activePromptId({ windows, activeWindowId: "right" })).toBe(
        "summariser",
      );
    });

    describe("when no pane has been recorded as active yet", () => {
      it("falls back to the first pane", () => {
        expect(activePromptId({ windows, activeWindowId: null })).toBe(
          "search-agent",
        );
      });
    });
  });

  describe("given the open tab is a draft that was never saved", () => {
    it("names no prompt, because a draft matches no row in the list", () => {
      const windows: Window[] = [
        {
          id: "w1",
          tabs: [
            {
              id: "tab-draft",
              data: {
                chat: { initialMessagesFromSpanData: [] },
                form: { currentValues: {} },
                meta: { title: null, versionNumber: undefined },
                variableValues: {},
              } as TabData,
            },
          ],
          activeTabId: "tab-draft",
        },
      ];

      expect(activePromptId({ windows, activeWindowId: "w1" })).toBeNull();
    });
  });
});
