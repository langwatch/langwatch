import { ListTable } from "@langwatch/design-system/list-table";
import {
  Badge,
  Button,
  Card,
  HStack,
  Spacer,
  Spinner,
  Table,
  Text,
} from "@langwatch/design-system/primitives";
import { nowInstant } from "@langwatch/time";

import { api } from "../../../../behavior/ops-api.ts";

/** Anomalous tenants: spiked enqueue rate or trace dominance (rate breaker, fingerprint
 * loop). Post-incident: surface tenant volume anomalies early. */
export function AnomaliesCard() {
  const query = api.ops.listAnomalies.useQuery(undefined, {});
  const dismiss = api.ops.dismissAnomaly.useMutation({
    onSuccess: () => query.refetch(),
  });

  const anomalies = query.data?.anomalies ?? [];
  const hasAny = anomalies.length > 0;
  const hasError = query.isError && !query.isFetching;
  const hardCount = anomalies.filter((a) => a.tier === "hard").length;

  // Nothing to report collapses onto the dashboard's health line rather than
  // spending a whole card saying so. An ERROR still renders: "we could not
  // check" is emphatically not "all clear", and hiding it would imply it was.
  if (!hasAny && !hasError) return null;

  return (
    <Card.Root borderColor={hardCount > 0 ? "red.muted" : "border.muted"}>
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
          <Text paddingX={4} paddingBottom={3} color="fg.error" textStyle="xs">
            Could not load anomalies. Redis may be unavailable. Retrying every 30s. Do NOT interpret
            this as &ldquo;all clear&rdquo;.
          </Text>
        )}
        {hasAny && (
          <ListTable
            density="compact"
            columnRules={false}
            containerProps={{ overflow: "visible" }}
            size="sm"
            variant="line"
          >
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
                    <Badge colorPalette={a.tier === "hard" ? "red" : "yellow"} size="xs">
                      {a.tier}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>{a.currentRate.toLocaleString()}/min</Table.Cell>
                  <Table.Cell>{a.baseline.toLocaleString()}/min</Table.Cell>
                  <Table.Cell>
                    <Text textStyle="xs">{formatAge(a.triggeredAt)}</Text>
                  </Table.Cell>
                  <Table.Cell maxW="320px">
                    <Text textStyle="xs" color="fg.muted" lineClamp={2}>
                      {a.reason}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Button
                      size="sm"
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
          </ListTable>
        )}
      </Card.Body>
    </Card.Root>
  );
}

function formatAge(triggeredAt: number): string {
  const ageMs = nowInstant().epochMilliseconds - triggeredAt;
  const m = Math.floor(ageMs / 60_000);
  if (m < 1) return "<1m ago";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}
