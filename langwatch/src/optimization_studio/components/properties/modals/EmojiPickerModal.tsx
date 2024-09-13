import EmojiPicker, {
  EmojiStyle,
  SkinTonePickerLocation,
} from "emoji-picker-react";
import { ConfigModal } from "./ConfigModal";
import { PopoverContent } from "@chakra-ui/react";

export function EmojiPickerModal({
  isOpen,
  onClose,
  onChange,
}: {
  isOpen: boolean;
  onClose: () => void;
  onChange: (emoji: string) => void;
}) {
  return (
    <ConfigModal
      isOpen={isOpen}
      onClose={onClose}
      title="Workflow Icon"
      unstyled
    >
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
