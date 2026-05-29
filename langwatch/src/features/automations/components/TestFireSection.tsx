import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { CircleCheck, CircleX, Send } from "lucide-react";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { useConfigComplete, useNotifyChannel, useTestHistory } from "../state/selectors";

/**
 * Test fire row + history. Coloured by the most recent attempt so the
 * eye picks up failures fast. The orchestrator owns the actual mutation
 * — this component receives `onFire` + `loading`.
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
  const bg = !last ? "bg" : lastIsSuccess ? "green.50" : "red.50";

  return (
    <Box
      border="1px solid"
      borderColor={borderColor}
      borderRadius="md"
      padding={3}
      bg={bg}
      _dark={{ bg: !last ? "bg" : lastIsSuccess ? "green.900" : "red.900" }}
    >
      <HStack align="start">
        <VStack align="start" gap={0} flex="1" minWidth="0">
          <HStack>
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
                Last attempt {formatTimeAgo(last.at)}
                {lastIsSuccess
                  ? ` — sent to ${last.recipientCount} ${
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
      {history.length > 1 ? (
        <VStack align="stretch" gap={1} mt={3} pl={1}>
          <Text textStyle="xs" color="fg.muted" fontWeight="semibold">
            Recent attempts
          </Text>
          {history.slice(1).map((attempt) => (
            <HStack key={attempt.at} gap={2} align="start">
              <Box pt="2px">
                {attempt.status === "success" ? (
                  <CircleCheck
                    size={12}
                    color="var(--chakra-colors-green-500)"
                  />
                ) : (
                  <CircleX size={12} color="var(--chakra-colors-red-500)" />
                )}
              </Box>
              <Text textStyle="xs" minWidth="100px" color="fg.muted">
                {formatTimeAgo(attempt.at)}
              </Text>
              <Text textStyle="xs" color="fg.muted" lineClamp={1}>
                {attempt.status === "success"
                  ? `${attempt.recipientCount} delivered${
                      attempt.usedDefault ? " (default template)" : ""
                    }`
                  : (attempt.errorDetail ?? attempt.errorTitle ?? "failed")}
              </Text>
            </HStack>
          ))}
        </VStack>
      ) : null}
    </Box>
  );
}
