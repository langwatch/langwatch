import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useRef,
  useState,
} from "react";
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
 * State + outside-click bookkeeping for the IOViewer panel. Engaged mode
 * dismisses on a `mousedown` outside the engaged ref so the panel never
 * traps wheel scroll once the user moves on.
 */
export function useIOViewerState({
  mode,
}: UseIOViewerStateArgs): IOViewerState {
  const [format, setFormat] = useState<ViewFormat>("pretty");
  // For output mode, default to bubbles — there's only ever one assistant
  // message, so a "Turn N" thread row is meaningless. For input mode (the
  // full chat history), keep thread as the default.
  const [chatLayout, setChatLayout] = useState<ChatLayout>(
    mode === "output" ? "bubbles" : "thread",
  );
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
