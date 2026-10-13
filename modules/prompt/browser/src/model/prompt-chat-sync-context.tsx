import { nowInstant } from "@langwatch/time";
import { createContext, type ReactNode, useCallback, useContext, useState } from "react";

/**
 * Represents a submit action broadcast to all synced chats.
 * Single Responsibility: Carries the message and timing info for broadcast submits.
 */
interface SubmitTrigger {
  /** The message to submit across all synced chats */
  message: string;
  /** Timestamp when submit was triggered (prevents duplicate processing) */
  timestamp: number;
}

/**
 * Chat input and submit-action sync state shared across all open Prompt
 * Studio tabs. Each chat tracks the last processed submit timestamp to avoid double-sends.
 */
interface PromptPlaygroundChatContextType {
  /** Current synced input value (shared across all tabs when sync enabled) */
  syncedInput: string;
  /** Update the synced input value */
  setSyncedInput: (input: string) => void;
  /** Whether sync is currently enabled. Defaults to true. */
  isSynced: boolean;
  /** Toggle sync on/off */
  setIsSynced: (synced: boolean) => void;
  /** Current submit trigger (null when no submit in progress) */
  submitTrigger: SubmitTrigger | null;
  /** Broadcast a submit action to all synced chats */
  triggerSubmit: (message: string) => void;
}

const PromptPlaygroundChatContext = createContext<PromptPlaygroundChatContextType | undefined>(
  undefined,
);

export function usePromptPlaygroundChatSync() {
  const context = useContext(PromptPlaygroundChatContext);
  if (!context) {
    throw new Error("usePromptPlaygroundChatSync must be used within PromptPlaygroundChatProvider");
  }
  return context;
}

interface PromptPlaygroundChatProviderProps {
  children: ReactNode;
}

/**
 * Provider for synced chat state across Prompt Studio tabs. `triggerSubmit`
 * broadcasts a timestamp-keyed trigger via context; each chat submits only
 * if it has not already processed that timestamp, so a broadcast fires once per chat.
 */
export function PromptPlaygroundChatProvider({ children }: PromptPlaygroundChatProviderProps) {
  const [syncedInput, setSyncedInput] = useState("");
  const [isSynced, setIsSynced] = useState(true);
  const [submitTrigger, setSubmitTrigger] = useState<SubmitTrigger | null>(null);

  /**
   * Broadcast a submit action to all synced chats.
   * Creates a new timestamp-based trigger that all listening chats will process.
   * Automatically clears the synced input after triggering.
   */
  const triggerSubmit = useCallback(
    (message: string) => {
      setSubmitTrigger({ message, timestamp: nowInstant().epochMilliseconds });
      // Clear input after broadcasting submit
      setSyncedInput("");
    },
    [setSyncedInput],
  );

  return (
    <PromptPlaygroundChatContext.Provider
      value={{
        syncedInput,
        setSyncedInput,
        isSynced,
        setIsSynced,
        submitTrigger,
        triggerSubmit,
      }}
    >
      {children}
    </PromptPlaygroundChatContext.Provider>
  );
}
