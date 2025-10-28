import { useState, useRef, useEffect } from "react";
import { Box } from "@chakra-ui/react";
import type { InputProps } from "@copilotkit/react-ui";
import { usePromptStudioChatSync } from "./PromptStudioChatContext";
import { ChatSendButton } from "./ui/ChatSendButton";
import { ChatSyncCheckbox } from "./ui/ChatSyncCheckbox";
import { ChatAttachButton } from "./ui/ChatAttachButton";
import { ChatTextArea } from "./ui/ChatTextArea";
import { useIsTabActive } from "../../hooks/useIsTabActive";

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
export function SyncedChatInput({
  inProgress,
  onSend,
  isVisible = true,
  onStop: _onStop,
  onUpload,
}: InputProps) {
  const {
    syncedInput,
    setSyncedInput,
    isSynced,
    setIsSynced,
    submitTrigger,
    triggerSubmit,
  } = usePromptStudioChatSync();
  const [localInput, setLocalInput] = useState("");
  const [isHovered, setIsHovered] = useState(false);
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
    void onSend(submitTrigger.message).catch((error) => {
      console.error("Failed to send synced message:", error);
    });
  }, [submitTrigger, isSynced, onSend, isTabActive]);

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
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  if (!isVisible) return null;

  return (
    <Box
      width="full"
      paddingX={4}
      paddingY={3}
      borderTop="1px solid"
      borderColor="gray.200"
      bg="white"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Box
        position="relative"
        borderRadius="lg"
        border="1px solid"
        borderColor="gray.300"
        _focusWithin={{ borderColor: "orange.500" }}
        bg="white"
      >
        <ChatTextArea
          inProgress={inProgress}
          value={currentInput}
          onChange={(e) => setCurrentInput(e.target.value)}
          onKeyDown={handleKeyDown}
          ref={textareaRef}
        />

        {/* Left icon - Paperclip */}
        <ChatAttachButton
          position="absolute"
          left={3}
          bottom={2}
          onAttach={onUpload}
        />

        {/* Bottom left - Sync checkbox (shows on hover) */}
        <ChatSyncCheckbox
          position="absolute"
          left="50%"
          bottom={2}
          transform="translateX(-50%)"
          checked={isSynced}
          onChange={setIsSynced}
          visible={isHovered}
        />

        {/* Right icon - Send button */}
        <ChatSendButton
          position="absolute"
          right={3}
          bottom={2}
          disabled={inProgress || !currentInput.trim()}
          onSend={handleSend}
        />
      </Box>
    </Box>
  );
}
