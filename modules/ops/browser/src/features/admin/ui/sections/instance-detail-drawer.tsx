import { Link } from "@langwatch/browser-host/link";
import { Card } from "@langwatch/design-system/card";
import { Drawer } from "@langwatch/design-system/drawer";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { FormattedNumber } from "@langwatch/design-system/formatted-number";
import { ListPageError, ListPageSkeleton } from "@langwatch/design-system/list-page";
import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import {
  Badge,
  Status,
  HStack,
  SimpleGrid,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { SummaryList, SummaryListItem as Detail } from "@langwatch/design-system/summary-list";

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
import { InstanceDiagnostics } from "../blocks/instance-diagnostics.tsx";
import { EmptyCell } from "../elements/admin-cells.tsx";
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
    <Drawer
      open={instanceRowId !== null}
      onClose={onClose}
      title={instance?.organizationName ?? instance?.hostname ?? "Self-hosted install"}
      eyebrow={{ label: "Self-hosted instance" }}
      size="lg"
    >
      <DrawerContent
        isLoading={query.isLoading}
        instance={instance}
        reports={query.data?.reports ?? []}
      />
    </Drawer>
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
  if (isLoading) return <ListPageSkeleton label="Loading instance" />;
  if (!instance) return <ListPageError title="Couldn't load this install." />;
  return (
    <VStack align="start" gap={6} width="full">
      <InstanceDetails instance={instance} />
      <DomainsSection instance={instance} />
      <LadderSection instance={instance} />
      <UsageSection instance={instance} />
      <InstanceDiagnostics instanceRowId={instance.id} />
      <HistorySection reports={reports} />
    </VStack>
  );
}

function InstanceDetails({ instance }: { instance: SelfHostedInstance }) {
  return (
    <SummaryList>
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
      <Detail label="First seen">
        <FormattedDate value={instance.firstSeenAt} display="date" />
      </Detail>
      <Detail label="Last report">
        <FormattedDate value={instance.lastSeenAt} />
      </Detail>
      <Detail label="Reports received">
        <FormattedNumber value={instance.reportCount} />
      </Detail>
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
    </SummaryList>
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
        href="/ops/cloud/licenses"
        textStyle="xs"
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
    <Card title="Who uses it" titleLevel={3}>
      {domains.length === 0 ? (
        <Text textStyle="sm" color="fg.muted">
          {instance.optionalMetricsReported
            ? "No domains reported."
            : "The optional category is switched off on this install."}
        </Text>
      ) : (
        <VStack align="start" gap={1} width="full">
          {domains.map(({ domain, count }) => (
            <HStack key={domain} gap={3} width="full">
              <Text textStyle="sm">{domain}</Text>
              <Text textStyle="sm" color="fg.muted">
                {count} {count === 1 ? "user" : "users"}
              </Text>
            </HStack>
          ))}
        </VStack>
      )}
    </Card>
  );
}

/**
 * The rungs of getting started. A rung never reached is shown as never
 * reached, rather than left out — where an install stalls is the answer.
 */
function LadderSection({ instance }: { instance: SelfHostedInstance }) {
  return (
    <Card title="Getting started" titleLevel={3}>
      <VStack align="start" gap={1} width="full">
        {ONBOARDING_LADDER.map(({ field, label }) => {
          const reached = reportText(instance.latestReport, field);
          return (
            <HStack key={field} gap={3} width="full">
              <Status.Root
                colorPalette={reached ? "green" : "gray"}
                aria-label={reached ? "Reached" : "Not reached"}
              >
                <Status.Indicator />
              </Status.Root>
              <Text textStyle="sm" flex={1}>
                {label}
              </Text>
              <Text textStyle="sm" color="fg.muted">
                {reached ? <FormattedDate value={reached} display="date" /> : "never reached"}
              </Text>
            </HStack>
          );
        })}
      </VStack>
    </Card>
  );
}

function UsageSection({ instance }: { instance: SelfHostedInstance }) {
  const rows = USAGE_ROWS.map(({ field, label }) => ({
    label,
    value: reportNumber(instance.latestReport, field),
  })).filter((row) => row.value !== null);

  return (
    <Card title="What they do" titleLevel={3}>
      {rows.length === 0 ? (
        <Text textStyle="sm" color="fg.muted">
          No usage numbers in the last report.
        </Text>
      ) : (
        <SimpleGrid columns={{ base: 1, md: 2 }} gap={2} width="full">
          {rows.map((row) => (
            <HStack key={row.label} gap={3}>
              <Text textStyle="sm" color="fg.muted" flex={1}>
                {row.label}
              </Text>
              <Text textStyle="sm">
                <FormattedNumber value={row.value ?? 0} />
              </Text>
            </HStack>
          ))}
        </SimpleGrid>
      )}
    </Card>
  );
}

function HistorySection({
  reports,
}: {
  reports: { id: string; receivedAt: string; version: string | null; unknownFields: number }[];
}) {
  return (
    <Card title="Reports" titleLevel={3} padding={reports.length === 0 ? "md" : "none"}>
      {reports.length === 0 ? (
        <NoDataInfoBlock
          size="line"
          title="No reports stored yet. Ask the instance administrator to check that usage reporting is configured and the instance can reach LangWatch."
        />
      ) : (
        <ListTable variant="embedded" density="compact" scroll="x" scrollLabel="Reports table">
          <ListTable.Header>
            <ListTable.Row>
              <ListTable.ColumnHeader>Received</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Release</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Fields we had no name for</ListTable.ColumnHeader>
            </ListTable.Row>
          </ListTable.Header>
          <ListTable.Body>
            {reports.map((report) => (
              <ListTable.Row key={report.id}>
                <ListTable.Cell>
                  <FormattedDate value={report.receivedAt} />
                </ListTable.Cell>
                <ListTable.Cell>{report.version ?? "not reported"}</ListTable.Cell>
                <ListTable.Cell>
                  <FormattedNumber value={report.unknownFields} />
                </ListTable.Cell>
              </ListTable.Row>
            ))}
          </ListTable.Body>
        </ListTable>
      )}
    </Card>
  );
}
