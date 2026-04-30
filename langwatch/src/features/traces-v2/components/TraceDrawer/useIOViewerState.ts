import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
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

  // Two-mode interaction: idle = panel is a static preview that lets wheel
  // events pass through to the page. Engaged (after a click) = fully
  // interactive with internal scroll. Clicking anywhere outside the panel
  // disengages it. Combined with `overscroll-behavior: auto` below, the
  // panel never traps scroll either at boundaries or globally.
  const [engaged, setEngaged] = useState(false);
  const engagedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!engaged) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target || !engagedRef.current) return;
      if (engagedRef.current.contains(target)) return;
      setEngaged(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [engaged]);

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
