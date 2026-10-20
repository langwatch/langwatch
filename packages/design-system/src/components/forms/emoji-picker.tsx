import { Button, type ButtonProps, Input, SimpleGrid, VStack } from "@chakra-ui/react";
import * as React from "react";

import { Popover } from "../overlays/popover.tsx";

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

export interface EmojiPickerProps extends Omit<ButtonProps, "value" | "onChange" | "children"> {
  value: string;
  onChange: (emoji: string) => void;
}

/**
 * Icon chooser: a button showing the current emoji that opens a short grid of common ones, or
 * takes any other typed in. The popover is portalled, so dialogs and drawers never clip it.
 */
export function EmojiPicker({
  value,
  onChange,
  "aria-label": ariaLabel = "Change icon",
  ...buttonProps
}: EmojiPickerProps) {
  const [open, setOpen] = React.useState(false);
  const choose = (emoji: string) => {
    onChange(emoji);
    setOpen(false);
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(details) => setOpen(details.open)}
      positioning={{ placement: "bottom-start" }}
      lazyMount
      unmountOnExit
    >
      <Popover.Trigger asChild>
        <Button
          variant="outline"
          textStyle="metric"
          flexShrink={0}
          aria-label={ariaLabel}
          {...buttonProps}
        >
          {value}
        </Button>
      </Popover.Trigger>
      <Popover.Content padding={3} width="auto">
        <VStack gap={2} align="stretch">
          <SimpleGrid columns={8} gap={1}>
            {COMMON_EMOJI.map((emoji) => (
              <Button
                key={emoji}
                variant="ghost"
                size="sm"
                textStyle="metric"
                aria-label={emoji}
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
              const typed = event.currentTarget.value.trim();
              if (event.key === "Enter" && typed) {
                event.preventDefault();
                choose(typed);
              }
            }}
          />
        </VStack>
      </Popover.Content>
    </Popover.Root>
  );
}
