import { LuCode, LuEye, LuList, LuMessageSquare } from "react-icons/lu";
import type { ChatLayout } from "./transcript";
import type { MarkdownSubmode, ViewFormat } from "./use-io-viewer-state";

/**
 * The format options for a panel, with the inline submode toggles the
 * active format carries.
 *
 * Both chat layouts (thread / bubbles) are available for any chat-shaped
 * content — input *or* output. Even with a single assistant reply, the
 * operator may want the bubble visual; conversely, a multi-message output
 * (rare but possible) benefits from the flat stack.
 */
export function formatSelectOptions({
  formatOptions,
  isChat,
  chatLayout,
  onChatLayoutChange,
  markdownSubmode,
  onMarkdownSubmodeChange,
}: {
  formatOptions: readonly ViewFormat[];
  isChat: boolean;
  chatLayout: ChatLayout;
  onChatLayoutChange: (layout: ChatLayout) => void;
  markdownSubmode: MarkdownSubmode;
  onMarkdownSubmodeChange: (submode: MarkdownSubmode) => void;
}) {
  return formatOptions.map((option) => {
    if (option === "pretty" && isChat) {
      return {
        value: option,
        submodes: {
          value: chatLayout,
          onChange: onChatLayoutChange,
          options: [
            {
              value: "thread",
              label: "Thread",
              icon: LuList,
              tooltip: "Thread layout",
            },
            {
              value: "bubbles",
              label: "Bubbles",
              icon: LuMessageSquare,
              tooltip: "Bubble layout",
            },
          ],
        },
      };
    }
    if (option === "markdown") {
      return {
        value: option,
        submodes: {
          value: markdownSubmode,
          onChange: onMarkdownSubmodeChange,
          options: [
            {
              value: "rendered",
              label: "Rendered",
              icon: LuEye,
              tooltip: "Rendered markdown view",
            },
            {
              value: "source",
              label: "Source",
              icon: LuCode,
              tooltip: "Source markdown view",
            },
          ],
        },
      };
    }
    return { value: option };
  });
}
