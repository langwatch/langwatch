import { InlineCode } from "@langwatch/design-system/inline-code";
import { Text } from "@langwatch/design-system/primitives";

import { useTickingNow } from "../../behavior/use-ticking-now.ts";
import { OLD_WRITERS_GONE_COMMAND, oldWritersGraceLine } from "../../model/upgrade-labels.ts";

/** Why a step waits out the grace for writers before the roster, how long, and what ends it. */
export function OldWritersGraceNote({
  endsAt,
  muted = false,
}: {
  endsAt: string;
  muted?: boolean;
}) {
  const nowMs = useTickingNow({ everyMs: 30_000 });
  return (
    <Text textStyle={muted ? "xs" : "sm"} color={muted ? "fg.muted" : undefined}>
      {oldWritersGraceLine({ endsAt, nowMs })}. That release cannot report its processes, so the
      step waits out a grace, or until <InlineCode>{OLD_WRITERS_GONE_COMMAND}</InlineCode> records
      they have stopped.
    </Text>
  );
}
