import { Alert, Code, CloseButton, HStack, Text } from "@chakra-ui/react";

import { api } from "~/utils/api";

/**
 * Presentational half, so the copy and the dismiss affordance can be
 * tested without a tRPC client.
 */
export function ExpiredIngestKeyNoticeView({
  onDismiss,
  dismissing = false,
}: {
  onDismiss: () => void;
  dismissing?: boolean;
}) {
  return (
    <Alert.Root
      status="warning"
      role="alert"
      aria-live="polite"
      width="full"
      border="1px solid"
      borderColor="colorPalette.muted"
      borderRadius={0}
      borderTopLeftRadius="xl"
    >
      <Alert.Indicator />
      <Alert.Content>
        <HStack width="full" wrap="wrap" gap={1}>
          <Text>
            Your coding agent tried to send traces with a session that is no
            longer valid, so nothing was recorded. Run{" "}
            <Code>langwatch login --device</Code> to reconnect it.
          </Text>
        </HStack>
      </Alert.Content>
      <CloseButton
        size="sm"
        position="absolute"
        right={2}
        top={2}
        aria-label="Dismiss"
        disabled={dismissing}
        onClick={onDismiss}
      />
    </Alert.Root>
  );
}

/**
 * Tools that export OTLP without going through `langwatch <tool>` (Claude
 * Code is the common one) have no terminal to warn in when their ingestion
 * key stops working: they retry into a 401 and the traces simply stop.
 * The ingest route records those attempts against the key's owner and this
 * is where the owner finds out.
 */
export function ExpiredIngestKeyNotice() {
  const utils = api.useContext();
  const notice = api.user.expiredIngestKeyNotice.useQuery(
    {},
    {
      // A dead session stays dead until someone re-logs in, so there is
      // nothing to gain from asking again on every navigation.
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: false,
    },
  );
  const dismiss = api.user.dismissExpiredIngestKeyNotice.useMutation({
    onSuccess: () => {
      void utils.user.expiredIngestKeyNotice.invalidate();
    },
  });

  if (!notice.data?.show) return null;

  return (
    <ExpiredIngestKeyNoticeView
      dismissing={dismiss.isLoading}
      onDismiss={() => dismiss.mutate({})}
    />
  );
}
