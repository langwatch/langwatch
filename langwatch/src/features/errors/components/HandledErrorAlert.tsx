import { Alert, Box, List, Text } from "@chakra-ui/react";

import {
  UNKNOWN_ERROR_PRESENTATION,
  explainHandledError,
} from "../logic/presentation";
import { readErrorTraceId, readHandledError } from "../logic/readHandledError";

import { ErrorActions } from "./ErrorActions";

export interface HandledErrorAlertProps {
  /** Any error — handled or not. Renders nothing when null/undefined. */
  error: unknown;
  /** Overrides the registry title where the surrounding context says it better. */
  title?: string;
  /**
   * Show every remediation tip as a list rather than folding the first into
   * the description. Inline alerts have the room; toasts don't.
   */
  showAllTips?: boolean;
}

/**
 * The inline counterpart to `showErrorToast` — same copy, same affordances,
 * rendered in place instead of over the top.
 *
 * Use this wherever the error belongs to a region of the page rather than to a
 * moment: a panel that failed to load, a form that was rejected, a step that
 * can't proceed. A toast is for something that just happened; an alert is for
 * something that is still true.
 */
export function HandledErrorAlert({
  error,
  title,
  showAllTips = true,
}: HandledErrorAlertProps) {
  if (!error) return null;

  const handled = readHandledError(error);
  const explanation = handled
    ? explainHandledError(handled)
    : UNKNOWN_ERROR_PRESENTATION;
  const tips = handled?.tips ?? [];

  return (
    <Alert.Root status="error" alignItems="flex-start">
      <Alert.Indicator />
      <Alert.Content gap={1}>
        <Alert.Title>{title ?? explanation.title}</Alert.Title>
        {explanation.description && (
          <Alert.Description>{explanation.description}</Alert.Description>
        )}

        {showAllTips && tips.length > 0 && (
          <List.Root gap={0.5} marginTop={1} fontSize="sm" paddingLeft={4}>
            {tips.map((tip) => (
              <List.Item key={tip}>{tip}</List.Item>
            ))}
          </List.Root>
        )}
        {!showAllTips && tips[0] && (
          <Text fontSize="sm" marginTop={1}>
            {tips[0]}
          </Text>
        )}

        <Box>
          <ErrorActions
            docsUrl={handled?.docsUrl}
            traceId={readErrorTraceId(error)}
          />
        </Box>
      </Alert.Content>
    </Alert.Root>
  );
}
