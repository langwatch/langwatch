import {
  Box,
  EmptyState,
  HStack,
  Heading,
  Spacer,
  Spinner,
  Stat,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { BarChart3 } from "lucide-react";
import { useMemo, useState } from "react";

import { DashboardLayout } from "~/components/DashboardLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { GatewayLayout } from "~/components/gateway/GatewayLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

const PRESETS: Array<{ label: string; days: number }> = [
  { label: "Last 24h", days: 1 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

function GatewayUsagePage() {
  const { project } = useOrganizationTeamProject();
  const [days, setDays] = useState(30);

  const { fromIso, toIso } = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    return { fromIso: from.toISOString(), toIso: to.toISOString() };
  }, [days]);

  const summaryQuery = api.gatewayUsage.summary.useQuery(
    { projectId: project?.id ?? "", fromDate: fromIso, toDate: toIso },
    { enabled: !!project?.id },
  );

  const data = summaryQuery.data;

  return (
    <GatewayLayout>
      <PageLayout.Container>
        <PageLayout.Header>
          <PageLayout.Heading>Usage</PageLayout.Heading>
          <Spacer />
          <HStack gap={1}>
            {PRESETS.map((p) => (
              <Box
                key={p.days}
                as="button"
                paddingX={3}
                paddingY={1}
                borderRadius="md"
                fontSize="xs"
                fontWeight={days === p.days ? "semibold" : "normal"}
                background={days === p.days ? "orange.100" : "transparent"}
                color={days === p.days ? "orange.800" : "fg.muted"}
                borderWidth="1px"
                borderColor={days === p.days ? "orange.300" : "border.subtle"}
                onClick={() => setDays(p.days)}
              >
                {p.label}
              </Box>
            ))}
          </HStack>
        </PageLayout.Header>

        <Box padding={6}>
          {summaryQuery.isLoading ? (
            <Spinner />
          ) : !data || data.totalRequests === 0 ? (
            <EmptyState.Root>
              <EmptyState.Content>
                <EmptyState.Indicator>
                  <BarChart3 size={32} />
                </EmptyState.Indicator>
                <EmptyState.Title>No usage in this window</EmptyState.Title>
                <EmptyState.Description>
                  Spend shows up here once the gateway debits budgets after a
                  completed request. Try sending a few requests against a
                  virtual key, then come back in a couple of minutes.
                </EmptyState.Description>
              </EmptyState.Content>
            </EmptyState.Root>
          ) : (
            <VStack align="stretch" gap={6}>
              <HStack gap={4} align="stretch">
                <StatTile
                  label="Total spend"
                  value={`$${Number(data.totalUsd).toFixed(2)}`}
                />
                <StatTile
                  label="Requests"
                  value={data.totalRequests.toLocaleString()}
                />
                <StatTile
                  label="Avg $/request"
                  value={`$${Number(data.avgUsdPerRequest).toFixed(6)}`}
                />
                <StatTile
                  label="Blocked by guardrail"
                  value={data.blockedRequests.toLocaleString()}
                  tone={data.blockedRequests > 0 ? "red" : undefined}
                />
              </HStack>

              <VStack align="stretch" gap={2}>
                <Heading size="sm">Top virtual keys</Heading>
                <Table.Root size="sm">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>Key</Table.ColumnHeader>
                      <Table.ColumnHeader>Prefix</Table.ColumnHeader>
                      <Table.ColumnHeader>Spend</Table.ColumnHeader>
                      <Table.ColumnHeader>Requests</Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {data.byVirtualKey.map((row) => (
                      <Table.Row key={row.virtualKeyId}>
                        <Table.Cell>{row.name}</Table.Cell>
                        <Table.Cell>
                          <Text fontFamily="mono" fontSize="xs">
                            {row.displayPrefix}…
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          ${Number(row.totalUsd).toFixed(2)}
                        </Table.Cell>
                        <Table.Cell>{row.requests}</Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </VStack>

              <VStack align="stretch" gap={2}>
                <Heading size="sm">Top models</Heading>
                <Table.Root size="sm">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>Model</Table.ColumnHeader>
                      <Table.ColumnHeader>Spend</Table.ColumnHeader>
                      <Table.ColumnHeader>Requests</Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {data.byModel.map((row) => (
                      <Table.Row key={row.model}>
                        <Table.Cell>
                          <Text fontFamily="mono" fontSize="xs">
                            {row.model}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          ${Number(row.totalUsd).toFixed(2)}
                        </Table.Cell>
                        <Table.Cell>{row.requests}</Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </VStack>
            </VStack>
          )}
        </Box>
      </PageLayout.Container>
    </GatewayLayout>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "red";
}) {
  return (
    <Box
      flex={1}
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="lg"
      padding={4}
    >
      <Stat.Root>
        <Stat.Label>{label}</Stat.Label>
        <Stat.ValueText color={tone === "red" ? "red.600" : undefined}>
          {value}
        </Stat.ValueText>
      </Stat.Root>
    </Box>
  );
}

export default withPermissionGuard("gatewayUsage:view", {
  layoutComponent: DashboardLayout,
})(GatewayUsagePage);
