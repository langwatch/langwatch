/** Inline error alert; says failure using host's explanation or generic fallback. */

import { Alert, List, Text } from "@chakra-ui/react";
import { AlertCircle } from "lucide-react";

import { explainErrorCode } from "../../model/error-presentation.ts";
import {
  readAuthoredMessage,
  readErrorTraceId,
  readHandledError,
} from "../../model/read-handled-error.ts";

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
    <Alert.Root status="error" role="alert" className={className}>
      <Alert.Indicator>
        <AlertCircle aria-hidden="true" />
      </Alert.Indicator>
      <Alert.Content>
        <Alert.Title>{headline}</Alert.Title>
        <Alert.Description>{description}</Alert.Description>

        {showAllTips && tips.length > 0 && (
          <List.Root gap={0.5} marginTop={1} textStyle="xs" color="fg.muted" paddingLeft={4}>
            {/* Index key: tips are server-supplied prose, so two can be
                  identical and collide as keys. Their order is fixed. */}
            {tips.map((tip, index) => (
              <List.Item key={index}>{tip}</List.Item>
            ))}
          </List.Root>
        )}
        {!showAllTips && tips[0] && (
          <Text textStyle="xs" color="fg.muted">
            {tips[0]}
          </Text>
        )}

        {traceId ? (
          <Text textStyle="xs" color="fg.subtle">
            Error id {traceId}
          </Text>
        ) : null}
      </Alert.Content>
    </Alert.Root>
  );
}
