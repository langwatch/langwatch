/**
 * A failure that is still true, said in place.
 *
 * The inline counterpart to a toast: a toast is for something that just
 * happened, an alert for a panel that is still broken.
 *
 * Harvested from `platform/app/src/features/errors/components/HandledErrorAlert.tsx`
 * with the same prop shape, the same restrained hairline and the same tip
 * list, minus the one thing that could not travel verbatim: the code-keyed
 * presentation registry, which supplies the specific title and description. It
 * is ~3,700 lines of the whole product's error copy and belongs in a package
 * of its own; until then the HOST answers for it through
 * `AuthHostPort.explainErrorCode`, and a composition that lists no copy for a
 * code degrades to the action name plus the generic line — which is exactly
 * what the registry itself answers for a code it does not list (ADR-045).
 *
 * `ErrorActions` did not travel either: it renders the copyable trace id and
 * lives in `platform/app`. The trace id is read here and printed plainly.
 */

import { Box, HStack, List, Stack, Text } from "@chakra-ui/react";
import { AlertCircle } from "lucide-react";

import { explainErrorCode } from "../../model/error-presentation";
import {
  readAuthoredMessage,
  readErrorTraceId,
  readHandledError,
} from "../../model/read-handled-error";

/**
 * The same restrained hairline the toast wears — the tone lives in the border
 * and the icon, never in a filled wash.
 */
const HAIRLINE =
  "color-mix(in srgb, var(--chakra-colors-red-solid) 26%, var(--chakra-colors-border-muted))";

/** Copy for a failure with no handled payload at all. See ADR-045. */
const UNKNOWN_TITLE = "Something went wrong";
const UNKNOWN_DESCRIPTION = "We've been notified. Try again in a moment.";

export interface HandledErrorAlertProps {
  /** Any error — handled or not. Renders nothing when null or undefined. */
  error: unknown;
  /** Headline for a failure we have no specific copy for. */
  fallbackTitle?: string;
  /** Hard override of the title, registry entry or not. Rare. */
  title?: string;
  /**
   * Show every remediation tip as a list rather than folding the first into
   * the description. Inline alerts have the room; toasts do not.
   */
  showAllTips?: boolean;
  /**
   * A surface that paints its own ground — the signed-out front door's glass —
   * hooks its treatment on here. The alert keeps its own structure and colour;
   * only the pane it sits on changes.
   */
  className?: string;
}

export function HandledErrorAlert({
  error,
  title,
  fallbackTitle,
  showAllTips = true,
  className,
}: HandledErrorAlertProps) {
  if (error === null || error === void 0) return null;

  const handled = readHandledError(error);
  const registered = handled ? explainErrorCode(handled) : null;
  const headline = title ?? registered?.title ?? fallbackTitle ?? UNKNOWN_TITLE;
  // A procedure that wrote its own sentence for the customer is the one
  // channel below the registry: #5984 left a non-5xx `TRPCError`'s message
  // alone precisely so it could be read here.
  const description = registered?.description ?? readAuthoredMessage(error) ?? UNKNOWN_DESCRIPTION;
  const tips = handled?.tips ?? [];
  const traceId = readErrorTraceId(error);

  return (
    <Box
      role="alert"
      className={className}
      borderWidth="1px"
      borderColor={HAIRLINE}
      borderRadius="12px"
      bg="bg.surface"
      _dark={{ bg: "bg.panel" }}
      paddingX="14px"
      paddingY="12px"
    >
      <HStack gap="2.5" alignItems="flex-start">
        <Box color="red.fg" display="flex" flexShrink={0} marginTop="1px">
          <AlertCircle size={15} aria-hidden="true" />
        </Box>

        <Stack gap="0.5" flex="1" minWidth={0}>
          <Text fontSize="13.5px" fontWeight="640" lineHeight="1.35" letterSpacing="-0.005em">
            {headline}
          </Text>
          <Text fontSize="13px" lineHeight="1.5" color="fg.muted">
            {description}
          </Text>

          {showAllTips && tips.length > 0 && (
            <List.Root gap={0.5} marginTop={1.5} fontSize="12.5px" color="fg.muted" paddingLeft={4}>
              {/* Index key: tips are server-supplied prose, so two can be
                  identical and collide as keys. Their order is fixed. */}
              {tips.map((tip, index) => (
                <List.Item key={index}>{tip}</List.Item>
              ))}
            </List.Root>
          )}
          {!showAllTips && tips[0] && (
            <Text fontSize="12.5px" marginTop={1} color="fg.muted">
              {tips[0]}
            </Text>
          )}

          {traceId ? (
            <Text fontSize="11.5px" marginTop={1} color="fg.subtle">
              Error id {traceId}
            </Text>
          ) : null}
        </Stack>
      </HStack>
    </Box>
  );
}
