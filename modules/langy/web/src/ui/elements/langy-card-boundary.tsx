/**
 * Per-card error boundary for the Langy transcript.
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
