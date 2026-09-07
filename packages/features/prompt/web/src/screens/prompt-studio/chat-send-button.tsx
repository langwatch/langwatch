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
 * The button's three looks: stopping a run, nothing to send, and ready. Kept
 * apart from the markup so the button itself reads as one control rather than
 * as a stack of conditional style props.
 */
function sendButtonAppearance({
  isStopping,
  isInactive,
}: {
  isStopping: boolean;
  isInactive: boolean;
}) {
  if (isStopping) {
    return {
      background: "red.solid",
      color: "white",
      cursor: "pointer",
      _hover: { filter: "brightness(1.08)" },
    } as const;
  }
  if (isInactive) {
    return {
      background: "bg.muted",
      color: "fg.muted",
      cursor: "default",
      _hover: undefined,
    } as const;
  }
  return {
    background: "orange.solid",
    color: "white",
    cursor: "pointer",
    _hover: { filter: "brightness(1.08)" },
  } as const;
}

export function ChatSendButton({
  inProgress = false,
  disabled = false,
  onSend,
  onStop,
}: ChatSendButtonProps) {
  const isStopping = inProgress && !!onStop;
  const isInactive = isStopping ? false : disabled || inProgress;

  return (
    <chakra.button
      type="button"
      aria-label={isStopping ? "Stop generating" : "Send message"}
      onClick={() => (isStopping ? onStop?.() : onSend())}
      disabled={isInactive}
      width="34px"
      height="34px"
      borderRadius="full"
      borderWidth={0}
      flexShrink={0}
      display="grid"
      placeItems="center"
      {...sendButtonAppearance({ isStopping, isInactive })}
      transition="background 150ms ease"
    >
      {/* The paper-plane's ink sits low-left of its own box, so centring the
          glyph geometrically leaves it looking low and left. The nudge is
          optical, and the square needs none of it. */}
      {isStopping ? (
        <LuSquare size={12} />
      ) : (
        <LuSend size={14} style={{ transform: "translate(-1px, 1px)" }} />
      )}
    </chakra.button>
  );
}
