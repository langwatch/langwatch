/**
 * Per-card error boundary for the Langy transcript.
 *
 * Every sub-card and block in a turn renders inside one of these: a card
 * whose renderer throws collapses to a quiet one-line note IN ITS PLACE, and
 * the rest of the answer — the prose, the other cards, the composer — stays
 * up. A transcript is many independent little renderers fed model- and
 * tenant-shaped data; one bad payload must never cost the whole panel.
 *
 * The fallback is chat-sized (one muted line, no red panel, no retry button
 * — a remount would just throw again on the same recorded data) and the
 * error still reaches the console for dev tooling and session replay.
 */
import { Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";

export function LangyCardBoundary({
  scope,
  children,
}: {
  /** What failed, in customer words: "this card", "this chart", "this plan". */
  scope: string;
  children: ReactNode;
}) {
  return (
    <ErrorBoundary
      fallback={
        <Text textStyle="2xs" color="fg.subtle" role="alert">
          Couldn&apos;t draw {scope}.
        </Text>
      }
      onError={(error) => {
        // eslint-disable-next-line no-console
        console.error("[LangyCardBoundary]", scope, error);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
