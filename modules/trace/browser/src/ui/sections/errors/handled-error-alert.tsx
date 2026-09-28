import { Alert, List, Text } from "@chakra-ui/react";
import { isHandledByGlobalHandler } from "@langwatch/browser-host/errors";
import { AlertCircle } from "lucide-react";

import { resolveErrorCopy } from "../../../behavior/errors/logic/resolve-error-copy.ts";
import { ErrorActions } from "../../elements/errors/error-actions.tsx";

export interface HandledErrorAlertProps {
  /**
   * Any error — handled or not. Renders nothing when null/undefined, or when a
   * global interceptor has already reported it.
   */
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
  /**
   * A surface that paints its own ground — the signed-out front door's glass —
   * hooks its treatment on here. The alert keeps its own structure and colour;
   * only the pane it sits on changes.
   */
  className?: string;
}

/**
 * The inline counterpart to `showErrorToast` — same copy, same affordances, rendered in
 * place instead of over the top.
 */
export function HandledErrorAlert({
  error,
  title,
  fallbackTitle,
  showAllTips = true,
  className,
}: HandledErrorAlertProps) {
  if (!error) return null;

  // Already surfaced by a global interceptor in `utils/api.tsx` — the upgrade
  // modal, or one of its bespoke toasts. `showErrorToast` has always made this
  // check; the alert did not, so a plan-limit refusal drew "Something went
  // wrong / We've been notified" underneath the modal that was busy explaining
  // it properly.
  if (isHandledByGlobalHandler(error)) return null;

  // One parse, and the same two rules the toast renders — whose headline
  // wins, and which tips add to the description rather than repeating it.
  const copy = resolveErrorCopy({ error, title, fallbackTitle });
  const { tips } = copy;

  return (
    <Alert.Root status="error" role="alert" className={className}>
      <Alert.Indicator>
        <AlertCircle aria-hidden="true" />
      </Alert.Indicator>
      <Alert.Content>
        <Alert.Title>{copy.title}</Alert.Title>
        {copy.description && <Alert.Description>{copy.description}</Alert.Description>}

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

        <ErrorActions docsUrl={copy.docsUrl} traceId={copy.traceId} />
      </Alert.Content>
    </Alert.Root>
  );
}
