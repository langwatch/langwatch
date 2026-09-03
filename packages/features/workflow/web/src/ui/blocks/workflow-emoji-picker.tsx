/**
 * Choosing the icon a new workflow is created with.
 *
 * A FAMILY-LOCAL COPY of
 * `platform/app/src/optimization_studio/components/properties/modals/EmojiPickerModal.tsx`,
 * which the agent and evaluator workflow-selector drawers also render, so the
 * platform module stays.
 *
 * ONE THING CHANGED, and it is the lazy load. `platform/app` deferred the
 * picker through `~/utils/compat/next-dynamic`, an application shim a feature
 * package may not import; `React.lazy` defers it the same way and for the same
 * reason. The reason is worth restating: a VALUE import of even a single enum
 * from `emoji-picker-react` collapses the whole library into whatever chunk
 * this module lands in, which is what the string literals below avoid.
 */

import { type BoxProps, PopoverContent } from "@chakra-ui/react";
import type { EmojiClickData, EmojiStyle, SkinTonePickerLocation } from "emoji-picker-react";
import { lazy, Suspense } from "react";

import { WorkflowConfigPopover } from "../elements/workflow-config-popover";

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
