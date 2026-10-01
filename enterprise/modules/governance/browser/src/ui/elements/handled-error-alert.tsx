/** Inline error alert for panels with unresolved errors; inline counterpart to toasts. */

import { Alert } from "@langwatch/design-system/primitives";
import { AlertCircle } from "lucide-react";

const UNKNOWN_DESCRIPTION = "Something went wrong on our side. Try again in a moment.";

export interface HandledErrorAlertProps {
  /** Any error, handled or not. Renders nothing when there is none. */
  error: unknown;
  /** Headline for a failure we have no specific copy for. */
  fallbackTitle?: string;
  /** Hard override of the title. Rare. */
  title?: string;
}

export function HandledErrorAlert({ error, title, fallbackTitle }: HandledErrorAlertProps) {
  if (error === null || error === void 0) return null;

  return (
    <Alert.Root status="error" role="alert">
      <Alert.Indicator>
        <AlertCircle aria-hidden />
      </Alert.Indicator>
      <Alert.Content>
        <Alert.Title>{title ?? fallbackTitle ?? "Something went wrong"}</Alert.Title>
        <Alert.Description>{UNKNOWN_DESCRIPTION}</Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}
