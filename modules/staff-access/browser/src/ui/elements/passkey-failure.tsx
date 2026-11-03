/** Why a passkey step did not go through: a cancelled prompt, or the server's refusal in words. */

import { Alert, Box, Button } from "@langwatch/design-system/primitives";
import { HandledErrorAlert } from "@langwatch/error-views";

import { PasskeyCancelledError } from "../../behavior/passkey-ceremony.ts";

export function PasskeyFailure({ failure, onRetry }: { failure: unknown; onRetry?: () => void }) {
  if (failure instanceof PasskeyCancelledError) {
    return (
      <Alert.Root status="info" data-testid="staff-access-ceremony-failed">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>The passkey check did not finish</Alert.Title>
          <Alert.Description>It was cancelled or timed out, so nothing changed.</Alert.Description>
        </Alert.Content>
        {onRetry && (
          <Button size="xs" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        )}
      </Alert.Root>
    );
  }
  return (
    <Box data-testid="staff-access-ceremony-failed">
      <HandledErrorAlert error={failure} onRetry={onRetry} />
    </Box>
  );
}
