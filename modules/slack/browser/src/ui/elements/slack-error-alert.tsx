import { Alert } from "@chakra-ui/react";
import { describeError } from "@langwatch/browser-host/errors";

/** A failure inline, worded by the error registry. Renders nothing when there is none. */
export function SlackErrorAlert({
  error,
  fallbackTitle,
}: {
  error: unknown;
  fallbackTitle: string;
}) {
  if (error === null || error === void 0) return null;
  return (
    <Alert.Root status="error" role="alert">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>{describeError({ error, fallbackTitle })}</Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}
