import { RawPopoverContent as PopoverContent } from "@langwatch/design-system/popover";
import {
  type BoxProps,
  Button,
  Input,
  SimpleGrid,
  VStack,
} from "@langwatch/design-system/primitives";

import { WorkflowConfigPopover } from "../../../../../elements/workflow/workflow-config-popover.tsx";

const COMMON_EMOJI = [
  "🧩",
  "🤖",
  "🧠",
  "⚡",
  "🔥",
  "🚀",
  "✨",
  "💡",
  "📊",
  "📈",
  "📝",
  "📚",
  "🔍",
  "🧪",
  "⚙️",
  "🛠️",
  "💬",
  "📦",
  "🎯",
  "🌐",
  "🔒",
  "🧭",
  "🎨",
  "✅",
];

/** Workflow icon chooser: a short list of common emoji, or type any other. */
export function EmojiPickerModal({
  open,
  onClose,
  onChange,
  ...props
}: {
  open: boolean;
  onClose: () => void;
  onChange: (emoji: string) => void;
} & Omit<BoxProps, "onChange">) {
  const choose = (emoji: string) => {
    onChange(emoji);
    onClose();
  };
  return (
    <WorkflowConfigPopover open={open} onClose={onClose} title="Workflow Icon" unstyled>
      <PopoverContent marginRight={4} position="absolute" marginTop="72px" padding={3} {...props}>
        <VStack gap={2} align="stretch">
          <SimpleGrid columns={8} gap={1}>
            {COMMON_EMOJI.map((emoji) => (
              <Button
                key={emoji}
                variant="ghost"
                size="sm"
                fontSize="18px"
                onClick={() => choose(emoji)}
              >
                {emoji}
              </Button>
            ))}
          </SimpleGrid>
          <Input
            size="sm"
            placeholder="Or type an emoji"
            onKeyDown={(event) => {
              const value = event.currentTarget.value.trim();
              if (event.key === "Enter" && value) choose(value);
            }}
          />
        </VStack>
      </PopoverContent>
    </WorkflowConfigPopover>
  );
}
