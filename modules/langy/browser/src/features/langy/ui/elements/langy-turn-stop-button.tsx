import { chakra, Spinner } from "@langwatch/design-system/primitives";
import { Square } from "lucide-react";

/**
 * Stop, on the working line above the composer. It stays through the stopping window, after the
 * client abort and until the backend confirms the terminal (ADR-078).
 */
export function LangyTurnStopButton({
  isStopping,
  onStop,
}: {
  isStopping: boolean;
  onStop: () => void;
}) {
  return (
    <chakra.button
      type="button"
      data-testid="langy-turn-stop"
      aria-label={isStopping ? "Stopping" : "Stop"}
      onClick={onStop}
      disabled={isStopping}
      display="inline-flex"
      alignItems="center"
      gap={1.5}
      flexShrink={0}
      height="26px"
      paddingX={2.5}
      borderRadius="full"
      borderWidth="1px"
      borderStyle="solid"
      borderColor="border.emphasized"
      background="bg.panel"
      color="fg.muted"
      textStyle="xs"
      fontWeight="medium"
      cursor={isStopping ? "default" : "pointer"}
      _hover={isStopping ? undefined : { color: "fg", borderColor: "border.inverted/40" }}
      _focusVisible={{ outline: "2px solid", outlineColor: "orange.focusRing" }}
    >
      {isStopping ? (
        <Spinner size="xs" borderWidth="1.5px" />
      ) : (
        <Square size={10} fill="currentColor" aria-hidden />
      )}
      {isStopping ? "Stopping" : "Stop"}
    </chakra.button>
  );
}
