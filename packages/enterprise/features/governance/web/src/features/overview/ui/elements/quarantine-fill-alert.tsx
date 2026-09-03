import { Alert, Box, HStack, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

export type QuarantineFillStats = {
  exceeded: boolean;
  rate: number;
  windowSeconds: number;
  perSource: Array<{
    ingestionSourceId: string | null;
    spanCount: number;
  }>;
};

/** Enterprise attribution warning copy and presentation, independent of RPC. */
export function QuarantineFillAlert({
  stats,
  reviewLink,
}: {
  stats: QuarantineFillStats | undefined;
  reviewLink: ReactNode;
}) {
  if (!stats?.exceeded) return null;

  return (
    <Alert.Root status="warning" variant="surface">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>
          {Math.round(stats.rate)} spans/min landing in quarantine — likely misconfigured
          ingest
        </Alert.Title>
        <Alert.Description>
          <VStack align="start" gap={2}>
            <Text fontSize="sm">
              Unrecognized traffic is being routed to the org-wide quarantine project
              (admin-only). End users do not see this data. Configure the credential on
              the source listed below to send traces to the right scope.
            </Text>
            {stats.perSource.length > 0 && (
              <Box>
                <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                  Top contributors (last {stats.windowSeconds}s)
                </Text>
                <VStack align="start" gap={0.5} marginTop={1}>
                  {stats.perSource.slice(0, 5).map((row) => (
                    <HStack
                      key={row.ingestionSourceId ?? "unknown"}
                      gap={2}
                      fontSize="xs"
                    >
                      <Text fontFamily="mono">
                        {row.ingestionSourceId ?? "unknown source"}
                      </Text>
                      <Text color="fg.muted">{row.spanCount} spans</Text>
                    </HStack>
                  ))}
                </VStack>
              </Box>
            )}
            {reviewLink}
          </VStack>
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}
