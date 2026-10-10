/** Inline error alert; says failure using host's explanation or generic fallback. */

import { Alert, List, Text } from "@langwatch/design-system/primitives";
import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";

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
  /** Any error — handled or not. Omit when passing resolved description copy. */
  error?: unknown;
  /** Copy already resolved by the auth model or form validation. */
  description?: ReactNode;
  testId?: string;
  /** Headline for a failure we have no specific copy for. */
  fallbackTitle?: string;
  /** Hard override of the title, registry entry or not. Rare. */
  title?: string;
  /**
   * Show every remediation tip as a list rather than folding the first into
   * the description. Inline alerts have the room; toasts do not.
   */
  showAllTips?: boolean;
}

export function HandledErrorAlert({
  error,
  title,
  fallbackTitle,
  description: resolvedDescription,
  testId,
  showAllTips = true,
}: HandledErrorAlertProps) {
  if (error == null && resolvedDescription == null) return null;

  const handled = readHandledError(error);
  const registered = handled ? explainErrorCode(handled) : null;
  const headline = title ?? registered?.title ?? fallbackTitle ?? UNKNOWN_TITLE;
  // A procedure that wrote its own sentence for the customer is the one
  // channel below the registry: #5984 left a non-5xx `TRPCError`'s message
  // alone precisely so it could be read here.
  const description =
    resolvedDescription ??
    registered?.description ??
    readAuthoredMessage(error) ??
    UNKNOWN_DESCRIPTION;
  // A tip that only repeats the description says it twice; main's toasts drop it the same way.
  const tips = (handled?.tips ?? []).filter((tip) => tip.trim() !== description.trim());
  const traceId = readErrorTraceId(error);

  return (
    // The design system's compact status alert, read left to right: mark, title, sentence.
    <Alert.Root status="error" role="alert" size="sm" alignItems="flex-start" data-testid={testId}>
      <Alert.Indicator marginTop="1px">
        <AlertCircle aria-hidden="true" />
      </Alert.Indicator>
      <Alert.Content textAlign="start" minWidth={0} gap={0.5}>
        <Alert.Title fontWeight={600}>{headline}</Alert.Title>
        <Alert.Description>{description}</Alert.Description>

        {showAllTips && tips.length > 0 && (
          <List.Root
            gap={0.5}
            marginTop={1}
            textStyle="xs"
            color="fg.muted"
            listStylePosition="inside"
          >
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
          <Text textStyle="xs" color="fg.subtle" overflowWrap="anywhere">
            Error id {traceId}
          </Text>
        ) : null}
      </Alert.Content>
    </Alert.Root>
  );
}
