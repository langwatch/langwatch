import { chakra } from "@chakra-ui/react";
import { LuSend, LuSquare } from "react-icons/lu";

/**
 * The composer's one action: send, or stop the run that is already going.
 *
 * A run in flight takes the button rather than sitting beside it — there is no
 * queue, so "send" has nothing to mean while a reply is arriving, and the
 * playground had no way to stop a run at all: the handler existed and the
 * composer dropped it on the floor.
 *
 * Round and fixed-size, matching Langy's composer, so the two controls read as
 * the same thing in two places.
 */
export interface ChatSendButtonProps {
  /** A run is in flight: the button stops it instead of sending. */
  inProgress?: boolean;
  /** Nothing to send — an empty field. Ignored while a run is in flight. */
  disabled?: boolean;
  onSend: () => void;
  onStop?: () => void;
}

/**
 * Everything the button looks like, derived from its two states.
 *
 * Kept out of the component because the appearance is a table rather than
 * logic, and reading it as one is easier than reading it spread across a
 * dozen props.
 */
function sendButtonAppearance({
  stopping,
  inactive,
}: {
  stopping: boolean;
  inactive: boolean;
}) {
  return {
    "aria-label": stopping ? "Stop generating" : "Send message",
    background: stopping ? "red.solid" : inactive ? "bg.muted" : "orange.solid",
    color: stopping || !inactive ? "white" : "fg.muted",
    cursor: inactive ? "default" : "pointer",
    _hover: inactive ? undefined : { filter: "brightness(1.08)" },
  };
}

export function ChatSendButton({
  inProgress = false,
  disabled = false,
  onSend,
  onStop,
}: ChatSendButtonProps) {
  const stopping = inProgress && !!onStop;
  const inactive = stopping ? false : disabled || inProgress;

  return (
    <chakra.button
      type="button"
      onClick={() => (stopping ? onStop?.() : onSend())}
      disabled={inactive}
      width="34px"
      height="34px"
      borderRadius="full"
      borderWidth={0}
      flexShrink={0}
      display="grid"
      placeItems="center"
      transition="background 150ms ease"
      {...sendButtonAppearance({ stopping, inactive })}
    >
      {/* The paper-plane's ink sits low-left of its own box, so centring the
          glyph geometrically leaves it looking low and left. The nudge is
          optical, and the square needs none of it. */}
      {stopping ? (
        <LuSquare size={12} />
      ) : (
        <LuSend size={14} style={{ transform: "translate(-1px, 1px)" }} />
      )}
    </chakra.button>
  );
}
