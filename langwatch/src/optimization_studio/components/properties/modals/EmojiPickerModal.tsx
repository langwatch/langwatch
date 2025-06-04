import dynamic from "next/dynamic";
import { ConfigModal } from "./ConfigModal";
import { PopoverContent } from "@chakra-ui/react";
import { EmojiStyle, SkinTonePickerLocation } from "emoji-picker-react";

const EmojiPicker = dynamic(
  () => import("emoji-picker-react").then(mod => mod.default),
  { ssr: false, loading: () => <div style={{ padding: 16 }}>Loading emoji picker...</div> }
);

export function EmojiPickerModal({
  open,
  onClose,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  onChange: (emoji: string) => void;
}) {
  return (
    <ConfigModal open={open} onClose={onClose} title="Workflow Icon" unstyled>
      <PopoverContent marginRight={4}>
        <EmojiPicker
          emojiStyle={EmojiStyle.NATIVE}
          skinTonePickerLocation={SkinTonePickerLocation.PREVIEW}
          onEmojiClick={(emojiData) => {
            onChange(emojiData.emoji);
            onClose();
          }}
        />
      </PopoverContent>
    </ConfigModal>
  );
}
