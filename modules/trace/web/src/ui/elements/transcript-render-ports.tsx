import { createContext, type ReactNode, useContext } from "react";
import type { MediaPartData } from "../../model/transcript/types.ts";

/** Host-owned widgets needed by transcript blocks at a browser boundary. */
export interface TranscriptRenderMembers {
  renderMediaPart?: (part: MediaPartData) => ReactNode;
  renderCommentAction?: (blockKey: string) => ReactNode;
  renderTerminalOutput?: (text: string, isError: boolean) => ReactNode;
}

const TranscriptRenderPortsContext = createContext<TranscriptRenderMembers>({});

export function TranscriptRenderProvider({
  children,
  ...ports
}: TranscriptRenderMembers & { children: ReactNode }) {
  const parentPorts = useContext(TranscriptRenderPortsContext);
  const mergedPorts = { ...parentPorts, ...ports };
  return (
    <TranscriptRenderPortsContext.Provider value={mergedPorts}>
      {children}
    </TranscriptRenderPortsContext.Provider>
  );
}

export function useTranscriptRenderPorts(): TranscriptRenderMembers {
  return useContext(TranscriptRenderPortsContext);
}
