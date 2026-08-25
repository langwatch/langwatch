import { Box, HStack, Spinner, Stack, Text } from "@chakra-ui/react";
import { useEffect, useRef } from "react";

/** How often to try again while nobody can reach us. */
const RETRY_EVERY_MS = 3_000;

/**
 * We cannot reach the server — said as a WAIT, not as a failure.
 *
 * This is the same slot the error alert uses and deliberately not the same
 * voice. A request that never left the browser is not a fault anybody has to
 * act on: a deploy is rolling, a laptop just woke, the server is still coming
 * up. The alert's red hairline, its "we've been notified" and its trace id
 * are all wrong here — one is alarm the reader cannot use, one is a promise
 * nothing kept, and the third is an id for a request that produced no trace.
 *
 * It also does NOT take the screen away. Whatever the reader was doing stays
 * where it was, because the thing they were part-way through is still valid
 * and will still be valid in four seconds. Throwing them back to the start of
 * a sign-in for a blip is the behavior this replaces.
 *
 * Where the caller can say what to try again, it retries on its own and
 * settles the moment the answer arrives.
 */
export function ServerUnreachableNotice({
  onRetry,
  className,
}: {
  /**
   * Runs the thing that failed, again. Optional: some callers have nothing
   * meaningful to re-run, and the notice is still worth showing to explain
   * why the screen has stopped.
   */
  onRetry?: () => void;
  className?: string;
}) {
  // Held in a ref so a caller that rebuilds the callback every render does not
  // restart the timer and retry forever without ever waiting.
  const retry = useRef(onRetry);
  retry.current = onRetry;

  useEffect(() => {
    if (!retry.current) return;
    const timer = setInterval(() => retry.current?.(), RETRY_EVERY_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box
      // A status rather than an alert: assistive technology should mention
      // this in passing, not interrupt for it.
      role="status"
      className={className}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="12px"
      bg="bg.surface"
      _dark={{ bg: "bg.panel" }}
      paddingX="14px"
      paddingY="12px"
      data-testid="server-unreachable-notice"
    >
      <HStack gap="2.5" alignItems="flex-start">
        <Box color="fg.muted" display="flex" flexShrink={0} marginTop="2px">
          <Spinner size="xs" borderWidth="1.5px" />
        </Box>
        <Stack gap="0.5" flex="1" minWidth={0}>
          <Text
            fontSize="13.5px"
            fontWeight="640"
            lineHeight="1.35"
            letterSpacing="-0.005em"
          >
            Waiting for LangWatch
          </Text>
          <Text fontSize="13px" lineHeight="1.5" color="fg.muted">
            {onRetry
              ? "We can't reach the server right now. This keeps trying on its own — nothing you have typed is lost."
              : "We can't reach the server right now. Check your connection, then try again."}
          </Text>
        </Stack>
      </HStack>
    </Box>
  );
}
