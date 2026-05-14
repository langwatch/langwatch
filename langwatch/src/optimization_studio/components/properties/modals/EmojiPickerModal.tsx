import { type BoxProps, PopoverContent } from "@chakra-ui/react";
import type { EmojiStyle, SkinTonePickerLocation } from "emoji-picker-react";
import dynamic from "~/utils/compat/next-dynamic";
import { ConfigModal } from "./ConfigModal";

// Use string literals matching the enum values rather than importing the
// runtime enums. A value-import of even a single enum from
// `emoji-picker-react` collapses the entire library into whatever chunk
// this module ends up in, defeating the `dynamic()` lazy load below and
// crashing app boot ("n is not a function") when the eager bundle of
// emoji-picker-react fails to initialise.
const EMOJI_STYLE_NATIVE = "native" as EmojiStyle;
const SKIN_TONE_PREVIEW = "PREVIEW" as SkinTonePickerLocation;

const EmojiPicker = dynamic(
  () => import("emoji-picker-react").then((mod) => mod.default),
  {
    ssr: false,
    loading: () => <div style={{ padding: 16 }}>Loading emoji picker...</div>,
  },
);

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
    <ConfigModal open={open} onClose={onClose} title="Workflow Icon" unstyled>
      <PopoverContent marginRight={4} position="absolute" marginTop="72px" {...props}>
        <EmojiPicker
          emojiStyle={EMOJI_STYLE_NATIVE}
          skinTonePickerLocation={SKIN_TONE_PREVIEW}
          onEmojiClick={(emojiData: any) => {
            onChange(emojiData.emoji);
            onClose();
          }}
        />
      </PopoverContent>
    </ConfigModal>
  );
}
