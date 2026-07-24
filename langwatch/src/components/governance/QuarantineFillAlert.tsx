import { Alert, Box, HStack, Text, VStack } from "@chakra-ui/react";

import { Link } from "~/components/ui/link";
import { api } from "~/utils/api";

/**
 * Admin warning surface for unattributed-trace landing rate. Polls
 * `governance.quarantineFillStats` every 60s; renders an orange Alert
 * naming the rate + per-source breakdown when the threshold is
 * crossed. Default contract per Sergey 5fba352c8: 60s window, 100
 * spans/min threshold (calibrated above quiescent + busy-but-healthy,
 * below misconfigured-puller loop volume).
 *
 * Members never see quarantine activity per ingestion-attribution
 * spec invariant — surface is gated by `governance:view` server-side.
 *
 * Spec: specs/ai-gateway/governance/ingestion-attribution.feature
 *       (quarantine-fill admin warning scenario)
 */
export function QuarantineFillAlert({
  organizationId,
}: {
  organizationId: string;
}) {
  const { data } = api.governance.quarantineFillStats.useQuery(
    { organizationId },
    {
      enabled: !!organizationId,
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: false,
    },
  );

  if (!data || !data.exceeded) return null;

  return (
    <Alert.Root status="warning" variant="surface">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>
          {Math.round(data.rate)} spans/min landing in quarantine — likely
          misconfigured ingest
        </Alert.Title>
        <Alert.Description>
          <VStack align="start" gap={2}>
            <Text fontSize="sm">
              Unrecognized traffic is being routed to the org-wide
              quarantine project (admin-only). End users do not see this
              data. Configure the credential on the source listed below
              to send traces to the right scope.
            </Text>
            {data.perSource.length > 0 && (
              <Box>
                <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                  Top contributors (last {data.windowSeconds}s)
                </Text>
                <VStack align="start" gap={0.5} marginTop={1}>
                  {data.perSource.slice(0, 5).map((row) => (
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
            <Link
              href="/settings/governance/ingestion-sources"
              fontSize="sm"
              color="orange.600"
            >
              Review ingestion sources →
            </Link>
          </VStack>
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}
