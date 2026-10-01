import { PopoverContent } from "@chakra-ui/react";
import { type BoxProps } from "@langwatch/design-system/primitives";
import type { EmojiClickData, EmojiStyle, SkinTonePickerLocation } from "emoji-picker-react";
import { lazy, Suspense } from "react";

import { WorkflowConfigPopover } from "../../../../elements/workflow-config-popover.tsx";

// Use string literals matching the enum values, not the runtime enums — a
// value-import from `emoji-picker-react` collapses the whole library into
// this chunk, defeating the `lazy()` load and crashing boot.
const EMOJI_STYLE_NATIVE = "native" as EmojiStyle;
const SKIN_TONE_PREVIEW = "PREVIEW" as SkinTonePickerLocation;

const EmojiPicker = lazy(() => import("emoji-picker-react"));

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
  return (
    <WorkflowConfigPopover open={open} onClose={onClose} title="Workflow Icon" unstyled>
      <PopoverContent marginRight={4} position="absolute" marginTop="72px" {...props}>
        <Suspense fallback={<div style={{ padding: 16 }}>Loading emoji picker...</div>}>
          <EmojiPicker
            emojiStyle={EMOJI_STYLE_NATIVE}
            skinTonePickerLocation={SKIN_TONE_PREVIEW}
            onEmojiClick={(emojiData: EmojiClickData) => {
              onChange(emojiData.emoji);
              onClose();
            }}
          />
        </Suspense>
      </PopoverContent>
    </WorkflowConfigPopover>
  );
}
