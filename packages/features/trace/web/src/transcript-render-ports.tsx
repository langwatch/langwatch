import { createContext, type ReactNode, useContext } from "react";
import type { MediaPartData } from "./transcript/types";

/** Host-owned widgets needed by transcript blocks at a browser boundary. */
export interface TranscriptRenderPorts {
  renderMediaPart?: (part: MediaPartData) => ReactNode;
  renderCommentAction?: (blockKey: string) => ReactNode;
  renderTerminalOutput?: (text: string, isError: boolean) => ReactNode;
}

const TranscriptRenderPortsContext = createContext<TranscriptRenderPorts>({});

export function TranscriptRenderProvider({
  children,
  ...ports
}: TranscriptRenderPorts & { children: ReactNode }) {
  const parentPorts = useContext(TranscriptRenderPortsContext);
  const mergedPorts = { ...parentPorts, ...ports };
  return (
    <TranscriptRenderPortsContext.Provider value={mergedPorts}>
      {children}
    </TranscriptRenderPortsContext.Provider>
  );
}

export function useTranscriptRenderPorts(): TranscriptRenderPorts {
  return useContext(TranscriptRenderPortsContext);
}
