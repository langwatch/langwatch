import { Box, HStack } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { useIsTabActive } from "../../hooks/useIsTabActive";
import { useDraggableTabsBrowserStore } from "../../prompt-playground-store/DraggableTabsBrowserStore";
import { useTabId } from "../prompt-browser/ui/TabContext";
import { usePromptPlaygroundChatSync } from "./PromptPlaygroundChatContext";
import { ChatSendButton } from "./ui/ChatSendButton";
import { ChatSyncCheckbox } from "./ui/ChatSyncCheckbox";
import { ChatTextArea } from "./ui/ChatTextArea";
import {
  type ChatVariableField,
  ChatVariableFields,
} from "./ui/ChatVariableFields";

/**
 * Custom chat input with sync across tabs functionality.
 * Single Responsibility: Provides chat input UI with optional sync and broadcast submit.
 *
 * Features:
 * - Synced input: When enabled, input text is shared across all chat instances
 * - Broadcast submit: When synced and submitted, all chats submit the same message
 * - Hover UI: Sync checkbox only visible on hover for clean interface
 * - Keyboard shortcuts: Enter to submit, Shift+Enter for new line
 */
/** Matches Langy's composer, so the two read as the same control. */
const COMPOSER_RADIUS = "18px";

export interface ChatInputProps {
  /** A run is in flight: the send button is held and Enter does nothing. */
  inProgress: boolean;
  onSend: (message: string) => void | Promise<void>;
  /** Cancels the run in flight. */
  onStop?: () => void;
  isVisible?: boolean;
  /** The variables this run will substitute, `input` excluded. */
  variables?: ChatVariableField[];
  /**
   * Required, because both callers pass it and a variable row you can type
   * into that reports nothing is worse than no row at all.
   */
  onVariableValueChange: (identifier: string, value: string) => void;
}

export function SyncedChatInput({
  inProgress,
  onSend,
  isVisible = true,
  onStop,
  variables = [],
  onVariableValueChange,
}: ChatInputProps) {
  const {
    syncedInput,
    setSyncedInput,
    isSynced,
    setIsSynced,
    submitTrigger,
    triggerSubmit,
  } = usePromptPlaygroundChatSync();
  const tabId = useTabId();
  const windowCount = useDraggableTabsBrowserStore(
    (state) => state.windows.length,
  );
  const [localInput, setLocalInput] = useState("");
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isTabActive = useIsTabActive();
  const lastProcessedTrigger = useRef<number>(
    // This is important: it prevents the chat from submitting on mount.
    submitTrigger?.timestamp ?? Date.now(),
  );

  // Use synced or local input based on sync state
  const currentInput = isSynced ? syncedInput : localInput;
  const setCurrentInput = isSynced ? setSyncedInput : setLocalInput;

  // Sync local to synced when enabling sync
  useEffect(() => {
    if (isSynced && localInput) {
      setSyncedInput(localInput);
    }
  }, [isSynced, localInput, setSyncedInput]);

  /**
   * Listen for submit triggers from other chats.
   * When a synced chat submits, all other synced chats receive the trigger
   * and submit the same message. Timestamps prevent duplicate processing.
   */
  useEffect(() => {
    if (!isSynced || !submitTrigger) return;

    // Prevent processing same trigger twice
    if (submitTrigger.timestamp <= lastProcessedTrigger.current) return;

    lastProcessedTrigger.current = submitTrigger.timestamp;

    // If the current tab is not active, don't submit the message.
    if (!isTabActive) return;

    // Submit the message
    void Promise.resolve(onSend(submitTrigger.message)).catch((error) => {
      console.error("Failed to send synced message:", error);
    });
  }, [submitTrigger, isSynced, onSend, isTabActive]);

  /**
   * handleSend
   * Single Responsibility: Sends message either locally or broadcasts to all synced chats.
   */
  const handleSend = async () => {
    if (!currentInput.trim() || inProgress) return;

    const message = currentInput;

    if (isSynced) {
      // Broadcast to all synced chats
      triggerSubmit(message);
      // Note: actual send happens via useEffect listening to submitTrigger
    } else {
      // Local-only send
      setCurrentInput("");
      try {
        await onSend(message);
      } catch (error) {
        console.error("Failed to send message:", error);
        setCurrentInput(message);
      }
    }

    // Keep focus on the textarea after sending
    textareaRef.current?.focus();
  };

  /**
   * handleKeyDown
   * Single Responsibility: Triggers send on Enter key (unless Shift held for new line).
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // An IME fires Enter to commit the candidate it is showing. Sending on
    // that one takes a half-written word off the composer and posts it, so
    // composition has to finish before Enter means send.
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // Enter is a no-op mid-run rather than a queue: the run in flight is the
      // one the reader is watching, and nothing here can hold a second.
      if (!inProgress) void handleSend();
    }
  };

  if (!isVisible) return null;

  return (
    <Box
      width="full"
      paddingX={4}
      paddingBottom={3}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* One integrated surface, the way Langy's composer reads: the field and
          its action live inside a single rounded card that lights up on focus,
          rather than a bordered box with a control floating over one corner. */}
      <Box
        position="relative"
        // Focus is tracked on the surface, not on the field: the sync checkbox
        // below is revealed by this same flag, so tracking the textarea alone
        // hid the checkbox the moment a keyboard user tabbed onto it — the
        // control kept focus while invisible and unclickable. React's focus
        // events bubble, and `relatedTarget` staying inside the card is what
        // tells a move between the field, the button and the checkbox apart
        // from a move out of the composer altogether.
        onFocus={() => setIsFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setIsFocused(false);
          }
        }}
        borderRadius={COMPOSER_RADIUS}
        borderWidth="1px"
        borderStyle="solid"
        borderColor={isFocused ? "orange.solid/60" : "border.emphasized"}
        // A soft translucent halo rather than a second, solid ring. The opaque
        // 4px band this replaced read as a thick brown border around the card
        // instead of as focus.
        boxShadow={
          isFocused
            ? "0 0 0 3px color-mix(in srgb, var(--chakra-colors-orange-solid) 16%, transparent)"
            : undefined
        }
        transition="border-color 150ms ease, box-shadow 150ms ease"
        bg="bg.panel"
        width="full"
        maxWidth="768px"
        margin="0 auto"
        overflow="hidden"
      >
        {/* What this run will substitute, above the field that starts it. The
            prompt's variables are declared in the editor beside the messages
            that reference them; what they are worth for one run is set here. */}
        {/* Gated on the variables, not on the handler: what decides whether
            the row belongs on screen is whether the prompt declares any.
            `ChatVariableFields` already renders nothing for an empty list, so
            requiring the callback too only meant a caller that passed
            variables and forgot the handler lost the row without a word. */}
        <ChatVariableFields
          variables={variables}
          onValueChange={onVariableValueChange}
        />

        {/* The field and the button are siblings on one row, bottom-aligned, so
            the action stays beside the last line as the field grows. They were
            previously an absolutely-positioned button over an empty flex row
            that existed only to reserve the height it sat in. */}
        <HStack gap={1.5} align="flex-end" paddingRight={2} paddingBottom={2}>
          <ChatTextArea
            inProgress={inProgress}
            value={currentInput}
            onChange={(e) => setCurrentInput(e.target.value)}
            onKeyDown={handleKeyDown}
            ref={textareaRef}
            data-tab-id={tabId}
          />
          <ChatSendButton
            inProgress={inProgress}
            disabled={!inProgress && !currentInput.trim()}
            onSend={() => void handleSend()}
            onStop={onStop}
          />
        </HStack>

        {/* Only worth a row of its own when there is more than one window to
            sync with; revealed on hover so the resting composer stays quiet. */}
        {windowCount > 1 && (
          <HStack justify="center" paddingBottom={2}>
            <ChatSyncCheckbox
              checked={isSynced}
              onChange={setIsSynced}
              visible={isHovered || isFocused}
            />
          </HStack>
        )}
      </Box>
    </Box>
  );
}
