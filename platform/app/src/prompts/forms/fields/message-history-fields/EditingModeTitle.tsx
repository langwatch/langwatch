import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { Check, ChevronDown } from "lucide-react";
import { Menu } from "~/components/ui/menu";

/**
 * Editing mode for the prompt messages field.
 * - "prompt": Simple view showing only the system instructions
 * - "messages": Full view showing all messages with role labels
 */
export type PromptEditingMode = "prompt" | "messages";

/**
 * What each mode is called in the UI. The stored key stays "prompt" because
 * it is what getDefaultEditingMode returns and what the tests bind to; only
 * the words the customer reads say "Instructions", which is what the system
 * message actually is.
 */
const EDITING_MODE_LABELS: Record<PromptEditingMode, string> = {
  prompt: "Instructions",
  messages: "Messages",
};

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
 * Mode switcher for the prompt editor.
 *
 * Rendered as a real button with a chevron rather than an uppercase section
 * title, because the heading treatment read as a static label and gave no
 * sign that a second mode existed behind it. Styling follows the lens-group
 * dropdowns in the traces toolbar: quiet by default, bordered so it is
 * obviously pressable.
 */
export function EditingModeTitle({
  mode,
  onChange,
}: {
  mode: PromptEditingMode;
  onChange: (mode: PromptEditingMode) => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          size="xs"
          variant="outline"
          type="button"
          gap={1.5}
          paddingX={2}
          fontSize="xs"
          fontWeight="medium"
          color="fg"
          borderColor="border.muted"
          _hover={{ bg: "bg.subtle", borderColor: "border.emphasized" }}
          aria-label={`Editing mode: ${EDITING_MODE_LABELS[mode]}`}
        >
          {EDITING_MODE_LABELS[mode]}
          <Box color="fg.muted" data-testid="editing-mode-chevron">
            <ChevronDown size={14} />
          </Box>
        </Button>
      </Menu.Trigger>
      <Menu.Content
        portalled={false}
        backgroundColor="bg.panel"
        minWidth="260px"
      >
        <EditingModeItem
          value="prompt"
          mode={mode}
          onChange={onChange}
          description="One set of instructions for the model"
        />
        <EditingModeItem
          value="messages"
          mode={mode}
          onChange={onChange}
          description="Instructions plus user and assistant messages"
        />
      </Menu.Content>
    </Menu.Root>
  );
}

/**
 * One row of the mode menu. The second line is what tells a first-time reader
 * why they would pick the other mode, which a bare pair of nouns did not.
 */
function EditingModeItem({
  value,
  mode,
  onChange,
  description,
}: {
  value: PromptEditingMode;
  mode: PromptEditingMode;
  onChange: (mode: PromptEditingMode) => void;
  description: string;
}) {
  const selected = mode === value;
  return (
    <Menu.Item
      value={value}
      onClick={() => onChange(value)}
      data-testid={`editing-mode-${value}`}
    >
      <HStack width="full" gap={2} align="flex-start">
        {/* Kept in the layout when unselected so the two rows' labels line up. */}
        <Box
          color={selected ? "fg" : "transparent"}
          paddingTop="2px"
          flexShrink={0}
        >
          <Check size={14} />
        </Box>
        <Box>
          <Text fontWeight={selected ? "medium" : "normal"}>
            {EDITING_MODE_LABELS[value]}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {description}
          </Text>
        </Box>
      </HStack>
    </Menu.Item>
  );
}
