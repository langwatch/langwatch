/**
 * Choosing the icon a new workflow is created with.
 * Uses React.lazy to defer the emoji picker and avoid collapsing the library.
 */

import { type BoxProps, PopoverContent } from "@chakra-ui/react";
import { WorkflowConfigPopover } from "@langwatch/workflow-browser-kit";
import type { EmojiClickData, EmojiStyle, SkinTonePickerLocation } from "emoji-picker-react";
import { lazy, Suspense } from "react";

const EMOJI_STYLE_NATIVE = "native" as EmojiStyle;
const SKIN_TONE_PREVIEW = "PREVIEW" as SkinTonePickerLocation;

const EmojiPicker = lazy(async () => {
  const module = await import("emoji-picker-react");
  return { default: module.default };
});

export function WorkflowEmojiPicker({
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
