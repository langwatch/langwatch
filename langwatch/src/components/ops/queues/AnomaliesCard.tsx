import {
  Badge,
  Button,
  Card,
  HStack,
  Spacer,
  Spinner,
  Table,
  Text,
} from "@chakra-ui/react";
import { useMemo } from "react";
import { api } from "~/utils/api";

/**
 * Anomalous-tenants panel. Lists tenants whose enqueue rate has spiked
 * far above their normal baseline (rate breaker) or whose traces are
 * being dominated by a single structural fingerprint (fingerprint loop).
 *
 * Post-2026-05-11 incident follow-up. On the day of the outage we had no
 * way to see "tenant X is 96% of cluster volume" until customers were
 * already paging us. This panel surfaces it within minutes.
 */
export function AnomaliesCard() {
  const query = api.ops.listAnomalies.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const dismiss = api.ops.dismissAnomaly.useMutation({
    onSuccess: () => query.refetch(),
  });

  const anomalies = query.data?.anomalies ?? [];
  const hasAny = anomalies.length > 0;
  const hasError = query.isError && !query.isFetching;
  const hardCount = useMemo(
    () => anomalies.filter((a) => a.tier === "hard").length,
    [anomalies],
  );

  return (
    <Card.Root borderColor={hardCount > 0 ? "red.300" : undefined}>
      <Card.Body padding={0}>
        <HStack paddingX={4} paddingY={2.5}>
          <Text textStyle="sm" fontWeight="medium">
            Anomalous tenants
          </Text>
          {hardCount > 0 && (
            <Badge colorPalette="red" variant="solid">
              {hardCount} hard
            </Badge>
          )}
          {hasAny && hardCount === 0 && (
            <Badge colorPalette="yellow">{anomalies.length} surfaced</Badge>
          )}
          <Spacer />
          {query.isFetching && <Spinner size="xs" />}
        </HStack>
        {hasError && (
          <Text paddingX={4} paddingBottom={3} color="red.500" textStyle="xs">
            Could not load anomalies — Redis may be unavailable. Retrying every
            30s. Do NOT interpret this as &ldquo;all clear&rdquo;.
          </Text>
        )}
        {!hasAny && !query.isLoading && !hasError && (
          <Text paddingX={4} paddingBottom={3} color="gray.500" textStyle="xs">
            No active anomalies in the last 60 minutes.
          </Text>
        )}
        {hasAny && (
          <Table.Root size="sm" variant="line">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Tenant</Table.ColumnHeader>
                <Table.ColumnHeader>Kind</Table.ColumnHeader>
                <Table.ColumnHeader>Tier</Table.ColumnHeader>
                <Table.ColumnHeader>Current</Table.ColumnHeader>
                <Table.ColumnHeader>Baseline</Table.ColumnHeader>
                <Table.ColumnHeader>Triggered</Table.ColumnHeader>
                <Table.ColumnHeader>Reason</Table.ColumnHeader>
                <Table.ColumnHeader />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {anomalies.map((a) => (
                <Table.Row key={`${a.kind}:${a.tenantId}`}>
                  <Table.Cell>
                    <Text fontFamily="mono" textStyle="xs">
                      {a.tenantId}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>{a.kind.replace("_", " ")}</Table.Cell>
                  <Table.Cell>
                    <Badge
                      colorPalette={a.tier === "hard" ? "red" : "yellow"}
                      size="xs"
                    >
                      {a.tier}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>{a.currentRate.toLocaleString()}/min</Table.Cell>
                  <Table.Cell>{a.baseline.toLocaleString()}/min</Table.Cell>
                  <Table.Cell>
                    <Text textStyle="xs">{formatAge(a.triggeredAt)}</Text>
                  </Table.Cell>
                  <Table.Cell maxW="320px">
                    <Text textStyle="xs" color="gray.600" lineClamp={2}>
                      {a.reason}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() =>
                        dismiss.mutate({
                          tenantId: a.tenantId,
                          kind: a.kind,
                        })
                      }
                    >
                      Dismiss
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </Card.Body>
    </Card.Root>
  );
}

function formatAge(triggeredAt: number): string {
  const ageMs = Date.now() - triggeredAt;
  const m = Math.floor(ageMs / 60_000);
  if (m < 1) return "<1m ago";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

