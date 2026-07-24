import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
} from "react";
import { create } from "zustand";
import type { ChatLayout } from "./transcript";

export type ViewFormat = "pretty" | "text" | "json" | "markdown";
export type MarkdownSubmode = "rendered" | "source";

interface UseIOViewerStateArgs {
  mode: "input" | "output";
}

interface IOViewerState {
  format: ViewFormat;
  setFormat: Dispatch<SetStateAction<ViewFormat>>;
  chatLayout: ChatLayout;
  setChatLayout: Dispatch<SetStateAction<ChatLayout>>;
  markdownSubmode: MarkdownSubmode;
  setMarkdownSubmode: Dispatch<SetStateAction<MarkdownSubmode>>;
  expanded: boolean;
  setExpanded: Dispatch<SetStateAction<boolean>>;
  collapsed: boolean;
  setCollapsed: Dispatch<SetStateAction<boolean>>;
  engaged: boolean;
  setEngaged: Dispatch<SetStateAction<boolean>>;
  engagedRef: RefObject<HTMLDivElement | null>;
}

/**
 * Shared chat-layout preference across every IOViewer instance.
 *
 * Operator complaint: toggling thread↔bubbles in INPUT didn't affect
 * OUTPUT (and vice-versa), even though they're two halves of the
 * same conversation. The toggle now lives in a tiny module-level
 * store so both panels read and write the same value.
 *
 * Thread is the default — flat ChatGPT-style stack reads naturally
 * for both the full input history and the single assistant reply.
 */
interface ChatLayoutPrefState {
  chatLayout: ChatLayout;
  setChatLayout: (next: ChatLayout) => void;
}
const useChatLayoutPref = create<ChatLayoutPrefState>((set) => ({
  chatLayout: "thread",
  setChatLayout: (next) => set({ chatLayout: next }),
}));

/**
 * State + outside-click bookkeeping for the IOViewer panel. Engaged mode
 * dismisses on a `mousedown` outside the engaged ref so the panel never
 * traps wheel scroll once the user moves on.
 */
export function useIOViewerState({
  mode,
}: UseIOViewerStateArgs): IOViewerState {
  const [format, setFormat] = useState<ViewFormat>("pretty");
  const chatLayout = useChatLayoutPref((s) => s.chatLayout);
  // Wrap the store setter as a `SetStateAction` so the existing IOViewer
  // call sites (`setChatLayout(v as ChatLayout)`, etc.) keep typechecking
  // without churn. The functional-updater branch evaluates against the
  // LATEST store state (not the render-time `chatLayout` closure), so
  // concurrent updates from multiple subscribers compose correctly
  // (CodeRabbit suggestion, PR #4084).
  const setChatLayout = useCallback<Dispatch<SetStateAction<ChatLayout>>>(
    (value) => {
      useChatLayoutPref.setState((state) => ({
        chatLayout:
          typeof value === "function"
            ? (value as (prev: ChatLayout) => ChatLayout)(state.chatLayout)
            : value,
      }));
    },
    [],
  );
  // `mode` is retained on the API for future per-mode defaults but no
  // longer drives the initial layout.
  void mode;
  // Markdown sub-mode: rendered (with formatting + Shiki for code fences)
  // or source (raw markdown text, syntax-highlighted as markdown).
  const [markdownSubmode, setMarkdownSubmode] =
    useState<MarkdownSubmode>("rendered");
  const [expanded, setExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // The previous two-mode interaction (idle vs. engaged) existed because
  // the IOViewer sat inside a single, full-drawer scroll container —
  // wheel events captured inside the panel would compete with the drawer
  // scroller. The new pane layout (TraceDrawerShell) gives every section
  // its own scroll container, so wheel events naturally scope to the
  // pane the cursor is over. The panel is now permanently "engaged" and
  // there is no outside-click disengage listener.
  const [engaged, setEngaged] = useState(true);
  const engagedRef = useRef<HTMLDivElement>(null);

  return {
    format,
    setFormat,
    chatLayout,
    setChatLayout,
    markdownSubmode,
    setMarkdownSubmode,
    expanded,
    setExpanded,
    collapsed,
    setCollapsed,
    engaged,
    setEngaged,
    engagedRef,
  };
}
