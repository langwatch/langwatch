import { Box, HStack, Text } from "@chakra-ui/react";
import { useState } from "react";
import { LuChevronDown } from "react-icons/lu";
import { Menu } from "~/components/ui/menu";
import { PropertySectionTitle } from "~/components/ui/PropertySectionTitle";

/**
 * Editing mode for the prompt messages field.
 * - "prompt": Simple view showing only the system prompt
 * - "messages": Full view showing all messages with role labels
 */
export type PromptEditingMode = "prompt" | "messages";

/**
 * Determines the default editing mode based on the messages.
 * Returns "messages" if there are messages beyond just system + optional user with {{input}}.
 */
export const getDefaultEditingMode = (
  messages: Array<{ role: string; content?: string }>,
): PromptEditingMode => {
  // Find system and non-system messages
  const _systemMessages = messages.filter((m) => m.role === "system");
  const nonSystemMessages = messages.filter((m) => m.role !== "system");

  // If only system message(s), default to prompt mode
  if (nonSystemMessages.length === 0) {
    return "prompt";
  }

  // If exactly one non-system message that is a user message with {{input}} or empty, default to prompt mode
  if (nonSystemMessages.length === 1) {
    const userMessage = nonSystemMessages[0];
    if (userMessage?.role === "user") {
      const content = userMessage.content?.trim() ?? "";
      if (content === "{{input}}" || content === "") {
        return "prompt";
      }
    }
  }

  // Otherwise, default to messages mode
  return "messages";
};

/**
 * Title with dropdown menu for switching between Prompt and Messages modes.
 */
export function EditingModeTitle({
  mode,
  onChange,
}: {
  mode: PromptEditingMode;
  onChange: (mode: PromptEditingMode) => void;
}) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <HStack
          gap={1}
          cursor="pointer"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          role="button"
          _hover={{ opacity: 0.8 }}
        >
          <PropertySectionTitle padding={0} paddingY={1}>
            {mode === "prompt" ? "Prompt" : "Messages"}
          </PropertySectionTitle>
          <Box
            opacity={isHovered ? 1 : 0}
            transition="opacity 0.15s"
            color="fg.muted"
          >
            <LuChevronDown size={14} />
          </Box>
        </HStack>
      </Menu.Trigger>
      <Menu.Content portalled={false} zIndex={10} backgroundColor="bg.panel">
        <Menu.Item
          value="prompt"
          onClick={() => onChange("prompt")}
          data-testid="editing-mode-prompt"
        >
          <Text fontWeight={mode === "prompt" ? "medium" : "normal"}>
            Prompt
          </Text>
        </Menu.Item>
        <Menu.Item
          value="messages"
          onClick={() => onChange("messages")}
          data-testid="editing-mode-messages"
        >
          <Text fontWeight={mode === "messages" ? "medium" : "normal"}>
            Messages
          </Text>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
