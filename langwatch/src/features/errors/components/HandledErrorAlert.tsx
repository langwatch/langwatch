import { Alert, Box, List, Text } from "@chakra-ui/react";

import {
  UNKNOWN_ERROR_PRESENTATION,
  explainHandledError,
} from "../logic/presentation";
import {
  readAuthoredMessage,
  readErrorTraceId,
  readHandledError,
} from "../logic/readHandledError";

import { ErrorActions } from "./ErrorActions";

export interface HandledErrorAlertProps {
  /** Any error — handled or not. Renders nothing when null/undefined. */
  error: unknown;
  /**
   * Headline for a failure we have no specific copy for — "Couldn't load
   * replicas". A code the registry knows keeps its own, better title.
   * This is the one you usually want.
   */
  fallbackTitle?: string;
  /** Hard override of the title, registry entry or not. Rare. */
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
  fallbackTitle,
  showAllTips = true,
}: HandledErrorAlertProps) {
  if (!error) return null;

  const handled = readHandledError(error);
  const authored = readAuthoredMessage(error);
  const explanation = handled
    ? explainHandledError(handled)
    : authored
      ? { ...UNKNOWN_ERROR_PRESENTATION, description: authored }
      : UNKNOWN_ERROR_PRESENTATION;

  // The registry description and the server's tips are competing authorings of
  // the same remediation — "Narrow the time range or add a filter" is both the
  // `query_timeout` description and its first tip — so rendering both makes
  // the alert repeat itself. Tips are written for agents with no registry to
  // read (ADR-045); they show here only when this client has no copy of its
  // own for the code.
  const tips = explanation.description ? [] : (handled?.tips ?? []);

  // Registry copy describes this exact failure, so it beats the caller's
  // generic headline. See `showErrorToast` for the same rule.
  const heading =
    title ??
    (explanation.isRegistered
      ? explanation.title
      : (fallbackTitle ?? explanation.title));

  return (
    <Alert.Root status="error" alignItems="flex-start">
      <Alert.Indicator />
      <Alert.Content gap={1}>
        <Alert.Title>{heading}</Alert.Title>
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
