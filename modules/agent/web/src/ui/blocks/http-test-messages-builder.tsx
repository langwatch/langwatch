import { Box, Button, Code, HStack, Spacer, Text, Textarea, VStack } from "@chakra-ui/react";
import { Menu } from "@langwatch/design-system/menu";
import { Minus, Plus } from "lucide-react";
import { useCallback } from "react";

export type TestMessage = {
  role: "user" | "assistant";
  content: string;
};

export type TestMessagesBuilderProps = {
  messages: TestMessage[];
  onChange: (messages: TestMessage[]) => void;
  disabled?: boolean;
};

function MessageRoleLabel({ role }: { role: TestMessage["role"] }) {
  return (
    <Text
      fontSize="xs"
      textTransform="none"
      fontWeight="normal"
      color="fg.muted"
      backgroundColor="bg.muted"
      paddingX={2}
      paddingY={0.5}
      borderRadius="lg"
      display="inline-block"
    >
      {role === "user" ? "User" : "Assistant"}
    </Text>
  );
}

function RemoveMessageButton({
  onRemove,
  disabled = false,
}: {
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <Button size="xs" variant="ghost" onClick={onRemove} type="button" disabled={disabled}>
      <Minus />
    </Button>
  );
}

function AddMessageButton({
  onAdd,
  disabled,
}: {
  onAdd: (role: TestMessage["role"]) => void;
  disabled?: boolean;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button size="xs" variant="outline" type="button" disabled={disabled}>
          <Plus /> Add
        </Button>
      </Menu.Trigger>
      <Menu.Content portalled={false}>
        <Menu.Item value="add-user" onClick={() => onAdd("user")}>
          User
        </Menu.Item>
        <Menu.Item value="add-assistant" onClick={() => onAdd("assistant")}>
          Assistant
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

/**
 * Single message row - matches the prompt playground UI
 */
function MessageRow({
  message,
  onChange,
  onRemove,
  disabled,
  canRemove,
}: {
  message: TestMessage;
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
        {canRemove && <RemoveMessageButton onRemove={onRemove} disabled={disabled} />}
      </HStack>
      <Textarea
        value={message.content}
        onChange={(e) => onChange({ ...message, content: e.target.value })}
        placeholder={
          message.role === "user" ? "Enter user message..." : "Enter assistant response..."
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
    [messages, onChange],
  );

  const handleRemove = useCallback(
    (index: number) => {
      onChange(messages.filter((_, i) => i !== index));
    },
    [messages, onChange],
  );

  const handleAdd = useCallback(
    (role: "user" | "assistant") => {
      onChange([...messages, { role, content: "" }]);
    },
    [messages, onChange],
  );

  return (
    <VStack align="stretch" gap={3} width="full">
      {/* Header with Add button */}
      <HStack width="full">
        <Text fontSize="xs" color="fg.muted" marginBottom={2}>
          <Code fontSize="xs">{`{{messages}}`}</Code>
        </Text>

        <Spacer />
        <AddMessageButton onAdd={handleAdd} />
      </HStack>

      <Box padding={4} bg="bg.subtle" borderRadius="md" borderWidth="1px" borderColor="border">
        {/* Message rows */}
        {messages.map((message, index) => (
          <MessageRow
            key={index}
            message={message}
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
  return JSON.stringify(messages.map((m) => ({ role: m.role, content: m.content })));
}
