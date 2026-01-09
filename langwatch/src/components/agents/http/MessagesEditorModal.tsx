import {
  Badge,
  Box,
  Button,
  HStack,
  NativeSelect,
  Spacer,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Dialog } from "~/components/ui/dialog";

export type Message = {
  role: string;
  content: string;
};

export type MessagesEditorModalProps = {
  open: boolean;
  onClose: () => void;
  messages: Message[];
  onSave: (messages: Message[]) => void;
  title?: string;
};

/**
 * Modal for editing chat messages with role selection.
 */
export function MessagesEditorModal({
  open,
  onClose,
  messages,
  onSave,
  title = "Edit Messages",
}: MessagesEditorModalProps) {
  const [localMessages, setLocalMessages] = useState<Message[]>(messages);

  // Reset when modal opens
  useEffect(() => {
    if (open) {
      setLocalMessages(
        messages.length > 0
          ? messages
          : [{ role: "user", content: "" }]
      );
    }
  }, [open, messages]);

  const handleAddMessage = useCallback((role: "user" | "assistant") => {
    setLocalMessages((prev) => [...prev, { role, content: "" }]);
  }, []);

  const handleRemoveMessage = useCallback((index: number) => {
    setLocalMessages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleUpdateMessage = useCallback(
    (index: number, updates: Partial<Message>) => {
      setLocalMessages((prev) =>
        prev.map((msg, i) => (i === index ? { ...msg, ...updates } : msg))
      );
    },
    []
  );

  const handleSave = useCallback(() => {
    // Filter out empty messages
    const filtered = localMessages.filter((m) => m.content.trim() !== "");
    onSave(filtered.length > 0 ? filtered : localMessages);
  }, [localMessages, onSave]);

  const handleClose = useCallback(() => {
    const hasChanges =
      JSON.stringify(localMessages) !== JSON.stringify(messages);
    if (hasChanges) {
      if (!window.confirm("Discard changes?")) {
        return;
      }
    }
    onClose();
  }, [localMessages, messages, onClose]);

  return (
    <Dialog.Root open={open} onOpenChange={({ open }) => !open && handleClose()}>
      <Dialog.Content minWidth="600px" maxWidth="800px">
        <Dialog.Header>
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap={4} maxHeight="60vh" overflow="auto">
            {localMessages.map((message, index) => (
              <MessageRow
                key={index}
                message={message}
                onUpdate={(updates) => handleUpdateMessage(index, updates)}
                onRemove={() => handleRemoveMessage(index)}
                canRemove={localMessages.length > 1}
              />
            ))}
            <HStack gap={2}>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleAddMessage("user")}
              >
                <Plus size={14} />
                User
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleAddMessage("assistant")}
              >
                <Plus size={14} />
                Assistant
              </Button>
            </HStack>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button colorPalette="blue" onClick={handleSave}>
            Save
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

type MessageRowProps = {
  message: Message;
  onUpdate: (updates: Partial<Message>) => void;
  onRemove: () => void;
  canRemove: boolean;
};

function MessageRow({ message, onUpdate, onRemove, canRemove }: MessageRowProps) {
  return (
    <Box
      borderWidth="1px"
      borderColor="gray.200"
      borderRadius="md"
      padding={3}
      background="gray.50"
    >
      <VStack align="stretch" gap={2}>
        <HStack>
          <NativeSelect.Root size="xs" width="120px">
            <NativeSelect.Field
              value={message.role}
              onChange={(e) => onUpdate({ role: e.target.value })}
            >
              <option value="user">User</option>
              <option value="assistant">Assistant</option>
              <option value="system">System</option>
            </NativeSelect.Field>
          </NativeSelect.Root>
          <Badge
            colorPalette={getRoleBadgeColor(message.role)}
            variant="subtle"
            fontSize="10px"
          >
            {message.role}
          </Badge>
          <Spacer />
          {canRemove && (
            <Button
              size="xs"
              variant="ghost"
              colorPalette="red"
              onClick={onRemove}
            >
              <Trash2 size={14} />
            </Button>
          )}
        </HStack>
        <Textarea
          value={message.content}
          onChange={(e) => onUpdate({ content: e.target.value })}
          placeholder={`Enter ${message.role} message...`}
          fontSize="13px"
          minHeight="80px"
          resize="vertical"
        />
      </VStack>
    </Box>
  );
}

function getRoleBadgeColor(role: string): string {
  switch (role) {
    case "user":
      return "blue";
    case "assistant":
      return "green";
    case "system":
      return "purple";
    default:
      return "gray";
  }
}
