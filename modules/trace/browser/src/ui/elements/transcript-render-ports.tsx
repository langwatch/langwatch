import type { MediaPartData } from "@langwatch/trace-contract/transcript";
import { createContext, type ReactNode, useContext } from "react";

/** Host-owned widgets needed by transcript blocks at a browser boundary. */
export interface TranscriptRenderMembers {
  renderMediaPart?: (part: MediaPartData) => ReactNode;
  renderCommentAction?: (blockKey: string) => ReactNode;
  renderTerminalOutput?: (text: string, isError: boolean) => ReactNode;
}

const TranscriptRenderContext = createContext<TranscriptRenderMembers>({});

export function TranscriptRenderProvider({
  children,
  ...members
}: TranscriptRenderMembers & { children: ReactNode }) {
  const parentMembers = useContext(TranscriptRenderContext);
  const mergedMembers = { ...parentMembers, ...members };
  return (
    <TranscriptRenderContext.Provider value={mergedMembers}>
      {children}
    </TranscriptRenderContext.Provider>
  );
}

export function useTranscriptRenderPorts(): TranscriptRenderMembers {
  return useContext(TranscriptRenderContext);
}
