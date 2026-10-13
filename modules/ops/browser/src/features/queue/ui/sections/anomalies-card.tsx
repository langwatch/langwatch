import { Card } from "@langwatch/design-system/card";
import { FormattedNumber } from "@langwatch/design-system/formatted-number";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { ListTable } from "@langwatch/design-system/list-table";
import { Badge, Button, Spinner, Text } from "@langwatch/design-system/primitives";
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
    <Card
      padding="none"
      title="Anomalous tenants"
      status={hardCount > 0 ? "bad" : void 0}
      badge={
        <>
          {hardCount > 0 && (
            <Badge colorPalette="red" variant="solid">
              {hardCount} hard
            </Badge>
          )}
          {hasAny && hardCount === 0 && (
            <Badge colorPalette="yellow">{anomalies.length} surfaced</Badge>
          )}
        </>
      }
      actions={query.isFetching ? <Spinner size="xs" /> : void 0}
    >
      {hasError && (
        <Text paddingX={4} paddingBottom={3} color="fg.error" textStyle="xs">
          Could not load anomalies. Redis may be unavailable. Retrying every 30s. Do NOT interpret
          this as &ldquo;all clear&rdquo;.
        </Text>
      )}
      {hasAny && (
        <ListTable
          density="compact"
          variant="embedded"
          scroll="x"
          scrollLabel="Anomalous tenants table"
        >
          <ListTable.Header>
            <ListTable.Row>
              <ListTable.ColumnHeader>Tenant</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Kind</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Tier</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Current</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Baseline</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Triggered</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Reason</ListTable.ColumnHeader>
              <ListTable.ColumnHeader label="Actions" />
            </ListTable.Row>
          </ListTable.Header>
          <ListTable.Body>
            {anomalies.map((a) => (
              <ListTable.Row key={`${a.kind}:${a.tenantId}`}>
                <ListTable.Cell>
                  <InlineCode variant="neutral">{a.tenantId}</InlineCode>
                </ListTable.Cell>
                <ListTable.Cell>{a.kind.replace("_", " ")}</ListTable.Cell>
                <ListTable.Cell>
                  <Badge colorPalette={a.tier === "hard" ? "red" : "yellow"} size="xs">
                    {a.tier}
                  </Badge>
                </ListTable.Cell>
                <ListTable.Cell>
                  <FormattedNumber value={a.currentRate} />
                  /min
                </ListTable.Cell>
                <ListTable.Cell>
                  <FormattedNumber value={a.baseline} />
                  /min
                </ListTable.Cell>
                <ListTable.Cell>
                  <Text textStyle="xs">{formatAge(a.triggeredAt)}</Text>
                </ListTable.Cell>
                <ListTable.Cell maxWidth="320px">
                  <Text textStyle="xs" color="fg.muted" lineClamp={2}>
                    {a.reason}
                  </Text>
                </ListTable.Cell>
                <ListTable.Cell>
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
                </ListTable.Cell>
              </ListTable.Row>
            ))}
          </ListTable.Body>
        </ListTable>
      )}
    </Card>
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
