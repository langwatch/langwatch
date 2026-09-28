/** Inline failure display (harvested from platform/app). Registry and ErrorActions
 * are later slice; uses generic line for unknown codes. */

import { Alert } from "@chakra-ui/react";
import { AlertCircle } from "lucide-react";

import { UNKNOWN_ERROR_DESCRIPTION } from "../../model/describe-error.ts";

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
        <Alert.Description>{UNKNOWN_ERROR_DESCRIPTION}</Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}
