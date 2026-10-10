/**
 * Data drawn from the browser's saved copy, held back until the network confirms it. While
 * unconfirmed it is dimmed and says when it is from; once confirmed it is shown as normal.
 * Presentational only: the caller reads freshness and passes it in.
 */
import { Box, HStack, Spinner, Text } from "@chakra-ui/react";
import { format, isToday, type Instant } from "@langwatch/time";
import type { ReactNode } from "react";

export interface CachedViewProps {
  /** When the data was fetched; null when that is not known. */
  asOf: Instant | null;
  /** True once the network has answered, or the data never came from the saved copy. */
  confirmed: boolean;
  /** The refresh finished without confirming: the pill says so and stops spinning. */
  failed?: boolean;
  "data-testid"?: string;
  children: ReactNode;
}

const UNCONFIRMED_OPACITY = 0.55;

function sinceWhen({ asOf }: { asOf: Instant }): string {
  const moment = asOf.epochMilliseconds;
  return format(moment, isToday(moment) ? "HH:mm" : "MMM d, HH:mm");
}

function pillCopy({ asOf, failed }: { asOf: Instant | null; failed: boolean }): string {
  if (!asOf) return failed ? "Couldn't refresh" : "Updating";
  const when = sinceWhen({ asOf });
  return failed ? `From ${when} · couldn't refresh` : `Showing data from ${when} · updating`;
}

export function CachedView({
  asOf,
  confirmed,
  failed = false,
  "data-testid": testId,
  children,
}: CachedViewProps) {
  const refreshing = !confirmed && !failed;
  return (
    <Box
      position="relative"
      width="full"
      height="full"
      aria-busy={refreshing ? "true" : void 0}
      data-testid={testId}
    >
      <Box
        width="full"
        height="full"
        opacity={confirmed ? 1 : UNCONFIRMED_OPACITY}
        transition="opacity 0.2s ease"
      >
        {children}
      </Box>
      {!confirmed && (
        <HStack
          as="output"
          position="absolute"
          top={1}
          left={1}
          zIndex={1}
          gap={1.5}
          paddingX={2}
          paddingY={0.5}
          borderRadius="full"
          borderWidth="1px"
          borderColor="border.muted"
          background="bg.panel"
          color="fg.muted"
          boxShadow="xs"
          data-testid={testId ? `${testId}-pill` : void 0}
        >
          {refreshing && <Spinner size="xs" />}
          <Text fontSize="xs" lineHeight="1.3">
            {pillCopy({ asOf, failed })}
          </Text>
        </HStack>
      )}
    </Box>
  );
}
