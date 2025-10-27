import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

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
 * Context for syncing chat input and submit actions across all open tabs in Prompt Studio.
 * Single Responsibility: Manages shared input state, sync toggle, and submit broadcasts.
 *
 * Architecture:
 * - When sync is enabled, all chat inputs share the same text value
 * - Submit actions broadcast to all synced chats via timestamp-based trigger
 * - Each chat tracks last processed timestamp to prevent duplicate sends
 */
interface PromptStudioChatContextType {
  /** Current synced input value (shared across all tabs when sync enabled) */
  syncedInput: string;
  /** Update the synced input value */
  setSyncedInput: (input: string) => void;
  /** Whether sync is currently enabled */
  isSynced: boolean;
  /** Toggle sync on/off */
  setIsSynced: (synced: boolean) => void;
  /** Current submit trigger (null when no submit in progress) */
  submitTrigger: SubmitTrigger | null;
  /** Broadcast a submit action to all synced chats */
  triggerSubmit: (message: string) => void;
}

const PromptStudioChatContext = createContext<
  PromptStudioChatContextType | undefined
>(undefined);

export function usePromptStudioChatSync() {
  const context = useContext(PromptStudioChatContext);
  if (!context) {
    throw new Error(
      "usePromptStudioChatSync must be used within PromptStudioChatProvider",
    );
  }
  return context;
}

interface PromptStudioChatProviderProps {
  children: ReactNode;
}

/**
 * Provider for synced chat state across tabs.
 * Single Responsibility: Provides context for chat input synchronization and submit broadcasts.
 *
 * Usage:
 * 1. Wrap your component tree with this provider
 * 2. Use `usePromptStudioChatSync()` in child components to access sync state
 * 3. When sync is enabled, input and submit actions are shared across all chat instances
 *
 * How Submit Broadcasting Works:
 * 1. User submits message in any synced chat
 * 2. `triggerSubmit()` creates a new trigger with current timestamp
 * 3. All synced chats receive the trigger via React context
 * 4. Each chat checks if it's already processed this timestamp
 * 5. Unprocessed chats submit the message and mark timestamp as processed
 * 6. This ensures each chat submits exactly once per broadcast
 */
export function PromptStudioChatProvider({
  children,
}: PromptStudioChatProviderProps) {
  const [syncedInput, setSyncedInput] = useState("");
  const [isSynced, setIsSynced] = useState(false);
  const [submitTrigger, setSubmitTrigger] = useState<SubmitTrigger | null>(
    null,
  );

  /**
   * Broadcast a submit action to all synced chats.
   * Creates a new timestamp-based trigger that all listening chats will process.
   * Automatically clears the synced input after triggering.
   */
  const triggerSubmit = useCallback(
    (message: string) => {
      setSubmitTrigger({ message, timestamp: Date.now() });
      // Clear input after broadcasting submit
      setSyncedInput("");
    },
    [setSyncedInput],
  );

  return (
    <PromptStudioChatContext.Provider
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
    </PromptStudioChatContext.Provider>
  );
}
