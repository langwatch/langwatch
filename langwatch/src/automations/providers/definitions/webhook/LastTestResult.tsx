import { Text, VStack } from "@chakra-ui/react";
import type { ConfigFormCtx } from "../../types";

/**
 * The most recent webhook test-fire outcome, rendered inline right under the
 * "Send a test" button — the author sees the real HTTP status (or what broke)
 * where they pressed the button, without hunting for a toast.
 */
export function LastTestResult({
  attempt,
}: {
  attempt: ConfigFormCtx["lastTestAttempt"];
}) {
  const last = attempt?.channel === "webhook" ? attempt : null;
  if (!last) return null;

  if (last.status === "success") {
    return (
      <Text textStyle="xs" color="fg.success" data-testid="webhook-test-result">
        Delivered{last.httpStatus ? ` — HTTP ${last.httpStatus}` : ""}.
      </Text>
    );
  }
  return (
    <VStack align="start" gap={0} data-testid="webhook-test-result">
      <Text textStyle="xs" color="fg.error" fontWeight="medium">
        {last.errorTitle ?? "Test request failed"}
      </Text>
      {last.errorDetail ? (
        <Text textStyle="xs" color="fg.error">
          {last.errorDetail}
        </Text>
      ) : null}
    </VStack>
  );
}
