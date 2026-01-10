import { Box, Code, HStack, Spacer, Text, Textarea, VStack } from "@chakra-ui/react";
import { useCallback } from "react";
import {
  MessageRoleLabel,
  AddMessageButton,
  RemoveMessageButton,
} from "../../ui/messages";

export type TestMessage = {
  role: "user" | "assistant";
  content: string;
};

export type TestMessagesBuilderProps = {
  messages: TestMessage[];
  onChange: (messages: TestMessage[]) => void;
  disabled?: boolean;
};

/**
 * Single message row - matches the prompt playground UI
 */
function MessageRow({
  message,
  index,
  onChange,
  onRemove,
  disabled,
  canRemove,
}: {
  message: TestMessage;
  index: number;
  onChange: (message: TestMessage) => void;
  onRemove: () => void;
  disabled?: boolean;
  canRemove: boolean;
}) {
  return (
    <Box width="full">
      <HStack width="full" paddingBottom={2}>
        <MessageRoleLabel role={message.role} />
        <Spacer />
        {canRemove && (
          <RemoveMessageButton onRemove={onRemove} disabled={disabled} />
        )}
      </HStack>
      <Textarea
        value={message.content}
        onChange={(e) => onChange({ ...message, content: e.target.value })}
        placeholder={
          message.role === "user"
            ? "Enter user message..."
            : "Enter assistant response..."
        }
        fontSize="sm"
        minHeight="80px"
        resize="vertical"
        disabled={disabled}
      />
    </Box>
  );
}

/**
 * Message builder for testing HTTP agents.
 * Uses the same UI components as the prompt playground.
 */
export function TestMessagesBuilder({
  messages,
  onChange,
  disabled = false,
}: TestMessagesBuilderProps) {
  const handleMessageChange = useCallback(
    (index: number, message: TestMessage) => {
      const newMessages = [...messages];
      newMessages[index] = message;
      onChange(newMessages);
    },
    [messages, onChange]
  );

  const handleRemove = useCallback(
    (index: number) => {
      onChange(messages.filter((_, i) => i !== index));
    },
    [messages, onChange]
  );

  const handleAdd = useCallback(
    (role: "user" | "assistant") => {
      onChange([...messages, { role, content: "" }]);
    },
    [messages, onChange]
  );

  return (
    <VStack align="stretch" gap={3} width="full">
      {/* Header with Add button */}
      <HStack width="full">
      <Text fontSize="xs" color="gray.600" marginBottom={2}>
          <Code fontSize="xs">{`{{messages}}`}</Code>
        </Text>

        <Spacer />
        <AddMessageButton onAdd={handleAdd} />
      </HStack>

      <Box
        padding={4}
        bg="gray.50"
        borderRadius="md"
        borderWidth="1px"
        borderColor="gray.200"
      >
        {/* Message rows */}
        {messages.map((message, index) => (
          <MessageRow
            key={index}
            message={message}
            index={index}
            onChange={(msg) => handleMessageChange(index, msg)}
            onRemove={() => handleRemove(index)}
            disabled={disabled}
            canRemove={messages.length > 1}
          />
        ))}
      </Box>
    </VStack>
  );
}

/**
 * Converts messages array to JSON string for template rendering
 */
export function messagesToJson(messages: TestMessage[]): string {
  return JSON.stringify(
    messages.map((m) => ({ role: m.role, content: m.content }))
  );
}
