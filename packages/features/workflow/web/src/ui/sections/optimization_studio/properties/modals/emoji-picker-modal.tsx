import { type BoxProps, PopoverContent } from "@chakra-ui/react";
import type { EmojiClickData, EmojiStyle, SkinTonePickerLocation } from "emoji-picker-react";
import { WorkflowConfigPopover } from "../../../../elements/workflow-config-popover";
import dynamic from "@langwatch/ui-host/compat/next-dynamic";

// Use string literals matching the enum values, not the runtime enums — a
// value-import from `emoji-picker-react` collapses the whole library into
// this chunk, defeating `dynamic()` lazy load and crashing boot.
const EMOJI_STYLE_NATIVE = "native" as EmojiStyle;
const SKIN_TONE_PREVIEW = "PREVIEW" as SkinTonePickerLocation;

const EmojiPicker = dynamic(() => import("emoji-picker-react").then((mod) => mod.default), {
  ssr: false,
  loading: () => <div style={{ padding: 16 }}>Loading emoji picker...</div>,
});

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
        <EmojiPicker
          emojiStyle={EMOJI_STYLE_NATIVE}
          skinTonePickerLocation={SKIN_TONE_PREVIEW}
          onEmojiClick={(emojiData: EmojiClickData) => {
            onChange(emojiData.emoji);
            onClose();
          }}
        />
      </PopoverContent>
    </WorkflowConfigPopover>
  );
}
