import { Text } from "@chakra-ui/react";

import { resolveErrorCopy } from "~/features/errors";
import { QuietNotice } from "./QuietNotice";

/**
 * A failure a section is still living with, in the one alert voice these
 * screens speak.
 *
 * The WORDS are not this component's: `resolveErrorCopy` is the single
 * implementation of "what does this error say to a customer", keyed by the
 * code the failure carries, falling back to the generic line and a trace id
 * for something we could not name. Only the chrome is local, which is the
 * whole point — one notice with tones, rather than a toast's treatment here, a
 * bordered alert there and a muted sentence somewhere else.
 *
 * Renders nothing without an error, so a section can mount it unconditionally
 * and say nothing on the happy path.
 */
export function SectionErrorNotice({
  error,
  fallbackTitle,
}: {
  error: unknown;
  /** The headline for a failure the registry has no entry for. */
  fallbackTitle: string;
}) {
  if (!error) return null;

  const copy = resolveErrorCopy({ error, fallbackTitle });

  return (
    <QuietNotice tone="danger" title={copy.title} testId="section-error-notice">
      {copy.description ? <Text>{copy.description}</Text> : null}
      {copy.traceId ? (
        <Text fontSize="xs" color="fg.muted" paddingTop={1}>
          Trace {copy.traceId}
        </Text>
      ) : null}
    </QuietNotice>
  );
}
