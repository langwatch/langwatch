/**
 * The note an activity card wears when the turn ended while the call was still
 * open — Stop was pressed, or the turn died.
 *
 * Without it such a card kept the running shell forever: a stopped trace search
 * still said "Searching traces…" with a live pulse and a shimmer, hours after
 * the turn ended, so the panel claimed work that nothing was doing. The card
 * keeps everything it had already found and states what happened to it.
 */
import { Text } from "@chakra-ui/react";

export const LANGY_INTERRUPTED_NOTE = "Interrupted before it finished";

export function LangyInterruptedNote() {
  return (
    <Text textStyle="2xs" color="fg.muted" fontStyle="italic">
      {LANGY_INTERRUPTED_NOTE}
    </Text>
  );
}
