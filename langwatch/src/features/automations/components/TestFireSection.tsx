import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { CircleCheck, CircleX, Send } from "lucide-react";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { useConfigComplete, useNotifyChannel, useTestHistory } from "../state/selectors";

/**
 * Test fire row — last-attempt status + button. Coloured by the most
 * recent attempt so the eye picks up failures fast.
 *
 * Industry-standard automation builders (Sentry, PagerDuty, Datadog)
 * show only the *last* test result inline; the per-attempt history was
 * useful for debugging but reads as noise in the steady state, so it's
 * gone. The orchestrator's toaster surfaces success/failure detail at
 * fire time; the store still keeps history in memory if we ever want
 * a "Recent attempts" disclosure later.
 */
export function TestFireSection({
  loading,
  onFire,
}: {
  loading: boolean;
  onFire: () => void;
}) {
  const channel = useNotifyChannel();
  const configComplete = useConfigComplete();
  const history = useTestHistory();

  if (!channel) return null;

  const last = history[0];
  const lastIsSuccess = last?.status === "success";
  const borderColor = !last
    ? "border"
    : lastIsSuccess
      ? "green.400"
      : "red.400";

  return (
    <Box
      border="1px solid"
      borderColor={borderColor}
      borderRadius="md"
      padding={3}
      bg="bg"
    >
      <HStack align="start" gap={3}>
        <VStack align="start" gap={0} flex="1" minWidth="0">
          <HStack gap={2}>
            <Text fontWeight="semibold">Test fire</Text>
            {last ? (
              lastIsSuccess ? (
                <CircleCheck size={14} color="var(--chakra-colors-green-500)" />
              ) : (
                <CircleX size={14} color="var(--chakra-colors-red-500)" />
              )
            ) : null}
          </HStack>
          <Text textStyle="sm" color="fg.muted" lineClamp={2}>
            {last ? (
              <>
                {formatTimeAgo(last.at)}
                {lastIsSuccess
                  ? ` — delivered to ${last.recipientCount} ${
                      channel === "email" ? "recipient" : "webhook"
                    }${(last.recipientCount ?? 0) === 1 ? "" : "s"}`
                  : ` — ${last.errorTitle ?? "failed"}`}
              </>
            ) : (
              "Send a banner-marked notification to the configured destination before saving."
            )}
          </Text>
        </VStack>
        <Button
          onClick={onFire}
          loading={loading}
          disabled={!configComplete}
          variant="outline"
          size="sm"
        >
          <Send size={14} /> Test fire
        </Button>
      </HStack>
    </Box>
  );
}
