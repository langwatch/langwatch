import { describeError } from "@langwatch/browser-host/errors";
import { Alert } from "@langwatch/design-system/primitives";
import { AlertCircle } from "lucide-react";

export interface HandledErrorAlertProps {
  /** Any error, handled or not. Renders nothing when there is none. */
  error: unknown;
  /** Headline for a failure the error registry has no specific copy for. */
  fallbackTitle?: string;
}

/** A failure inline, worded by the error registry. */
export function HandledErrorAlert({ error, fallbackTitle }: HandledErrorAlertProps) {
  if (error === null || error === void 0) return null;

  return (
    <Alert.Root status="error" role="alert">
      <Alert.Indicator>
        <AlertCircle aria-hidden />
      </Alert.Indicator>
      <Alert.Content>
        <Alert.Description>{describeError({ error, fallbackTitle })}</Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}
