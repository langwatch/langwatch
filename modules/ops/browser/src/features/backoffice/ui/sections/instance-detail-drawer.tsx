import { Badge, Box, HStack, Link, SimpleGrid, Table, Text, VStack } from "@chakra-ui/react";
import { Drawer } from "@langwatch/design-system/drawer";

import { api } from "../../../../behavior/ops-api.ts";
import {
  ACTIVITY_COLORS,
  ACTIVITY_LABELS,
  ONBOARDING_LADDER,
  reportNumber,
  reportText,
  sortedDomains,
  USAGE_ROWS,
  type SelfHostedInstance,
} from "../../model/self-hosted-instance.ts";
import { EmptyCell, formatDate, formatDateTime } from "../elements/backoffice-cells.tsx";
import { Detail, Section } from "../elements/drawer-sections.tsx";
import { ShortId } from "../elements/short-id.tsx";

export function InstanceDetailDrawer({
  instanceRowId,
  onClose,
}: {
  instanceRowId: string | null;
  onClose: () => void;
}) {
  const query = api.selfHostedInstances.getById.useQuery(
    { id: instanceRowId ?? "" },
    { enabled: instanceRowId !== null, retry: false },
  );
  const instance = query.data?.instance;

  return (
    <Drawer.Root
      open={instanceRowId !== null}
      onOpenChange={({ open }) => !open && onClose()}
      size="lg"
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>
            {instance?.organizationName ?? instance?.hostname ?? "Self-hosted install"}
          </Drawer.Title>
        </Drawer.Header>
        <Drawer.CloseTrigger />
        <Drawer.Body>
          <DrawerContent
            isLoading={query.isLoading}
            instance={instance}
            reports={query.data?.reports ?? []}
          />
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function DrawerContent({
  isLoading,
  instance,
  reports,
}: {
  isLoading: boolean;
  instance: SelfHostedInstance | undefined;
  reports: { id: string; receivedAt: string; version: string | null; unknownFields: number }[];
}) {
  if (isLoading) return <Text color="fg.muted">Loading…</Text>;
  if (!instance) return <Text color="fg.error">Couldn't load this install.</Text>;
  return (
    <VStack align="start" gap={6} width="full">
      <InstanceDetails instance={instance} />
      <DomainsSection instance={instance} />
      <LadderSection instance={instance} />
      <UsageSection instance={instance} />
      <HistorySection reports={reports} />
    </VStack>
  );
}

function InstanceDetails({ instance }: { instance: SelfHostedInstance }) {
  return (
    <SimpleGrid columns={2} gap={4} width="full">
      <Detail label="Instance">
        <ShortId id={instance.instanceId} />
      </Detail>
      <Detail label="Activity">
        <Badge colorPalette={ACTIVITY_COLORS[instance.activity]}>
          {ACTIVITY_LABELS[instance.activity]}
        </Badge>
      </Detail>
      <Detail label="Release">{instance.version ?? "not reported"}</Detail>
      <Detail label="Installed with">
        {instance.installMethod ?? "not reported"}
        {instance.chartVersion ? ` ${instance.chartVersion}` : ""}
      </Detail>
      <Detail label="Hostname">{instance.hostname ?? "not reported"}</Detail>
      <Detail label="Environment">{instance.environment ?? "not reported"}</Detail>
      <Detail label="First seen">{formatDate(instance.firstSeenAt)}</Detail>
      <Detail label="Last report">{formatDateTime(instance.lastSeenAt)}</Detail>
      <Detail label="Reports received">{instance.reportCount}</Detail>
      <Detail label="Customer">
        <CustomerValue instance={instance} />
      </Detail>
      <Detail label="Users">
        {reportNumber(instance.latestReport, "users") ?? "not reported"}
      </Detail>
      <Detail label="Projects">
        {reportNumber(instance.latestReport, "projects") ?? "not reported"}
      </Detail>
      <Detail label="Sign-in">
        {reportText(instance.latestReport, "auth_method") ?? "not reported"}
        {reportText(instance.latestReport, "sso_provider")
          ? ` via ${reportText(instance.latestReport, "sso_provider")}`
          : ""}
      </Detail>
      <Detail label="Optional metrics">
        {instance.optionalMetricsReported ? "on" : "switched off"}
      </Detail>
    </SimpleGrid>
  );
}

/**
 * The customer, and the license that named them. An install with no license
 * is the open source baseline, a real answer rather than missing data.
 */
function CustomerValue({ instance }: { instance: SelfHostedInstance }) {
  if (!instance.issuedLicenseId) {
    return <EmptyCell>open source, no license</EmptyCell>;
  }
  return (
    <HStack gap={2}>
      <Text>{instance.organizationName ?? "license not linked yet"}</Text>
      <Link
        href="/ops/backoffice/licenses"
        fontSize="xs"
        color="fg.muted"
        onClick={(event) => event.stopPropagation()}
      >
        licenses
      </Link>
    </HStack>
  );
}

function DomainsSection({ instance }: { instance: SelfHostedInstance }) {
  const domains = sortedDomains(instance.userEmailDomains);
  return (
    <Section title="Who uses it">
      {domains.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          {instance.optionalMetricsReported
            ? "No domains reported."
            : "The optional category is switched off on this install."}
        </Text>
      ) : (
        <VStack align="start" gap={1} width="full">
          {domains.map(({ domain, count }) => (
            <HStack key={domain} gap={3} width="full">
              <Text fontSize="sm">{domain}</Text>
              <Text fontSize="sm" color="fg.muted">
                {count} {count === 1 ? "user" : "users"}
              </Text>
            </HStack>
          ))}
        </VStack>
      )}
    </Section>
  );
}

/**
 * The rungs of getting started. A rung never reached is shown as never
 * reached, rather than left out — where an install stalls is the answer.
 */
function LadderSection({ instance }: { instance: SelfHostedInstance }) {
  return (
    <Section title="Getting started">
      <VStack align="start" gap={1} width="full">
        {ONBOARDING_LADDER.map(({ field, label }) => {
          const reached = reportText(instance.latestReport, field);
          return (
            <HStack key={field} gap={3} width="full">
              <Box
                width="8px"
                height="8px"
                borderRadius="full"
                background={reached ? "green.500" : "border"}
              />
              <Text fontSize="sm" flex={1}>
                {label}
              </Text>
              <Text fontSize="sm" color="fg.muted">
                {reached ? formatDate(reached) : "never reached"}
              </Text>
            </HStack>
          );
        })}
      </VStack>
    </Section>
  );
}

function UsageSection({ instance }: { instance: SelfHostedInstance }) {
  const rows = USAGE_ROWS.map(({ field, label }) => ({
    label,
    value: reportNumber(instance.latestReport, field),
  })).filter((row) => row.value !== null);

  return (
    <Section title="What they do">
      {rows.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          No usage numbers in the last report.
        </Text>
      ) : (
        <SimpleGrid columns={2} gap={2} width="full">
          {rows.map((row) => (
            <HStack key={row.label} gap={3}>
              <Text fontSize="sm" color="fg.muted" flex={1}>
                {row.label}
              </Text>
              <Text fontSize="sm">{(row.value ?? 0).toLocaleString()}</Text>
            </HStack>
          ))}
        </SimpleGrid>
      )}
    </Section>
  );
}

function HistorySection({
  reports,
}: {
  reports: { id: string; receivedAt: string; version: string | null; unknownFields: number }[];
}) {
  return (
    <Section title="Reports">
      {reports.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          No reports stored yet.
        </Text>
      ) : (
        <Table.Root variant="line" size="sm">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Received</Table.ColumnHeader>
              <Table.ColumnHeader>Release</Table.ColumnHeader>
              <Table.ColumnHeader>Fields we had no name for</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {reports.map((report) => (
              <Table.Row key={report.id}>
                <Table.Cell>{formatDateTime(report.receivedAt)}</Table.Cell>
                <Table.Cell>{report.version ?? "not reported"}</Table.Cell>
                <Table.Cell>{report.unknownFields}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}
    </Section>
  );
}
