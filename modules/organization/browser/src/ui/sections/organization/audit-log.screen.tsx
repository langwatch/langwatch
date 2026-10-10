/**
 * The organization's audit trail, at `/settings/audit-log`. ONE TABLE OVER TWO WRITE SHAPES.
 */

import type { WireOf } from "@langwatch/api/web";
import { Lent } from "@langwatch/browser-host/lent";
import { InputGroup } from "@langwatch/design-system/input-group";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Alert,
  Badge,
  Box,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Table,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { ContactSalesToken } from "@langwatch/enterprise-billing-client";
import type { EnrichedAuditLog as StoredEnrichedAuditLog } from "@langwatch/organization-contract";

/** An audit row as the browser receives it: its instant is an ISO string. */
type EnrichedAuditLog = WireOf<StoredEnrichedAuditLog>;
import { neutralizeFormula, neutralizeRows } from "@langwatch/csv";
import { nowInstant } from "@langwatch/time";
import { ArrowLeft, Download, ScrollText, Search } from "lucide-react";
import Parse from "papaparse";
import { useMemo, useState } from "react";

import { organizationApi, type AuditLogFilters } from "../../../behavior/organization-api.ts";
import {
  auditLogCsvTable,
  auditLogExportOffsets,
  auditLogFileName,
  AUDIT_LOG_EXPORT_BATCH_SIZE,
} from "../../../model/audit-log-export.ts";
import {
  auditBackLink,
  matchMemberId,
  readAuditPaging,
  readAuditTarget,
  withAuditFilter,
  withAuditPageOffset,
  withAuditPageSize,
  withoutAuditTarget,
} from "../../../model/audit-log-filters.ts";
import { groupAuditRuns, auditOptionalColumns } from "../../../model/audit-log-rows.ts";
import {
  auditPeriodLabel,
  auditPeriodQuery,
  readAuditPeriod,
} from "../../../model/audit-period.ts";
import { disambiguateLabels } from "../../../model/disambiguate-labels.ts";
import { useOrganizationHost } from "../../../model/organization-host.ts";
import { AuditLogRunRow } from "../../../ui/blocks/audit-log-run-row.tsx";
import { AuditPaginationFooter } from "../../../ui/elements/audit-pagination-footer.tsx";
import { AuditPeriodPicker } from "../../../ui/elements/audit-period-picker.tsx";
import { Link } from "../../../ui/elements/organization-link.tsx";
import { SettingsRowsSkeleton } from "../../../ui/elements/settings-rows-skeleton.tsx";

function auditLogsView({
  isLoading,
  rowCount,
}: {
  isLoading: boolean;
  rowCount: number;
}): "loading" | "empty" | "table" {
  if (isLoading) return "loading";
  if (rowCount === 0) return "empty";
  return "table";
}

export default function AuditLogScreen() {
  const host = useOrganizationHost();
  const scope = host.scope();
  const organization = host.organization();
  const { query } = host.route();
  const organizationId = scope.organizationId ?? "";

  const now = useMemo(() => nowInstant(), []);
  const { period, mode } = readAuditPeriod(query, now);
  const { pageOffset, pageSize } = readAuditPaging(query);
  const target = readAuditTarget(query);

  const [userSearch, setUserSearch] = useState(query.userSearch ?? "");
  const [actionFilter, setActionFilter] = useState(query.actionFilter ?? "");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    scope.projectId ?? null,
  );
  const [isExporting, setIsExporting] = useState(false);

  const isEnterprise = host.isEnterprise();

  const members = organizationApi.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
    { organizationId, includeDeactivated: false },
    { enabled: !!organizationId },
  );
  const searchUserId = matchMemberId(members.data?.members ?? [], userSearch);

  const filters: AuditLogFilters = {
    organizationId,
    projectId: selectedProjectId ?? void 0,
    userId: searchUserId,
    action: actionFilter || void 0,
    startDate: period.startDate.epochMilliseconds,
    endDate: period.endDate.epochMilliseconds,
    targetKind: target?.targetKind,
    targetId: target?.targetId,
  };

  const auditLogs = organizationApi.organization.getAuditLogs.useQuery(
    { ...filters, pageOffset, pageSize },
    { enabled: !!organizationId && isEnterprise },
  );

  const utils = organizationApi.useUtils();

  if (!organizationId || host.isPlanLoading()) {
    return <SettingsRowsSkeleton rows={8} />;
  }

  if (!isEnterprise) {
    return (
      <VStack gap={6} width="full" align="start">
        <Alert.Root status="info">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Enterprise Feature</Alert.Title>
            <Alert.Description>
              Organisation-wide audit logs (AI Gateway events such as virtual-key, budget, provider
              and cache-rule changes, alongside logins, member changes, settings, RBAC and billing)
              are available on Enterprise plans. Contact sales to upgrade.
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
        <Box width="full">
          <Lent of={ContactSalesToken} props={{}} />
        </Box>
      </VStack>
    );
  }

  const rows: EnrichedAuditLog[] = auditLogs.data?.auditLogs ?? [];
  const totalHits = auditLogs.data?.totalCount ?? 0;
  const backLink = auditBackLink({ target, projectSlug: scope.projectSlug });
  const projects = (organization?.teams ?? []).flatMap((team) =>
    team.projects.map((project) => ({ id: project.id, label: project.name, teamName: team.name })),
  );

  const columns = auditOptionalColumns(rows);
  const projectLabel = (projectId: string) =>
    projects.find((project) => project.id === projectId)?.label ?? projectId;

  const logsView = auditLogsView({ isLoading: auditLogs.isLoading, rowCount: rows.length });

  const handleUserSearchChange = (value: string) => {
    setUserSearch(value);
    host.setQuery(withAuditFilter(query, { userSearch: value || void 0 }));
  };

  const handleActionFilterChange = (value: string) => {
    setActionFilter(value);
    host.setQuery(withAuditFilter(query, { actionFilter: value || void 0 }));
  };

  const handleProjectChange = (projectId: string | null) => {
    setSelectedProjectId(projectId);
    host.setQuery(withAuditFilter(query, { projectId: projectId ?? void 0 }));
  };

  /**
   * The whole filtered history, walked in batches and handed over as one file. `filters` is the
   * SAME object the table above is reading with, which is the property that makes an export
   * from a deep-link honest: it cannot widen.
   */
  const downloadCsv = async () => {
    setIsExporting(true);
    try {
      const first = await utils.organization.getAuditLogs.fetch({
        ...filters,
        pageOffset: 0,
        pageSize: AUDIT_LOG_EXPORT_BATCH_SIZE,
      });
      const collected = [...(first.auditLogs ?? [])];

      for (const offset of auditLogExportOffsets({ totalCount: first.totalCount })) {
        const batch = await utils.organization.getAuditLogs.fetch({
          ...filters,
          pageOffset: offset,
          pageSize: AUDIT_LOG_EXPORT_BATCH_SIZE,
        });
        if (!batch.auditLogs || batch.auditLogs.length === 0) break;
        collected.push(...batch.auditLogs);
      }

      // Both halves are guarded: an audit row carries the actor's name and the
      // arguments they passed, and a heading is fixed text only until somebody
      // renames a column.
      const { fields, data } = auditLogCsvTable(collected);
      host.download({
        fileName: auditLogFileName(nowInstant()),
        contents: Parse.unparse({
          fields: fields.map(neutralizeFormula),
          data: neutralizeRows(data),
        }),
        mediaType: "text/csv",
      });
    } catch (error) {
      // The platform page logged this to the console and left the reader
      // looking at a button that had visibly done nothing. A report that did
      // not arrive is exactly the kind of failure a compliance reviewer has to
      // be told about, so it is a notice now.
      host.failed({ error, fallbackTitle: "Couldn't export the audit log" });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Audit Log</PageLayout.Heading>
        <Spacer />
        {host.projectSwitcher()}
        <PageLayout.HeaderButton onClick={() => void downloadCsv()} disabled={isExporting}>
          <Download />
          Export CSV
        </PageLayout.HeaderButton>
      </PageLayout.Header>

      <VStack gap={4} width="full" align="start" paddingTop={4}>
        <VStack align="start" gap={1} width="full">
          {backLink && (
            <Link href={backLink.href} color="fg.muted" fontSize="sm">
              <HStack gap={1}>
                <ArrowLeft size={14} /> {backLink.label}
              </HStack>
            </Link>
          )}
          <Text color="fg.muted" fontSize="sm">
            Every change made in this organization: who made it, what changed and when. Filter by
            project, user, action or date range.
          </Text>
          {target && (
            <Badge
              colorPalette="orange"
              variant="surface"
              gap={1}
              cursor="pointer"
              onClick={() => host.setQuery(withoutAuditTarget(query))}
              title="Clear target filter"
            >
              {target.targetKind} = {target.targetId.slice(0, 24)}… ×
            </Badge>
          )}
        </VStack>

        <HStack gap={2} width="full" flexWrap="wrap">
          <InputGroup startElement={<Search size={14} />} width="240px">
            <Input
              size="sm"
              placeholder="Search by name or email..."
              aria-label="Search by User"
              value={userSearch}
              onChange={(event) => handleUserSearchChange(event.target.value)}
            />
          </InputGroup>
          <Input
            size="sm"
            width="200px"
            placeholder="Filter by action..."
            aria-label="Filter by Action"
            value={actionFilter}
            onChange={(event) => handleActionFilterChange(event.target.value)}
          />
          <NativeSelect.Root size="sm" width="200px">
            <NativeSelect.Field
              aria-label="Project"
              value={selectedProjectId ?? "all"}
              onChange={(event) =>
                handleProjectChange(event.target.value === "all" ? null : event.target.value)
              }
            >
              <option value="all">All Projects</option>
              {disambiguateLabels(projects, (project) => project.teamName).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.displayLabel}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
          <AuditPeriodPicker
            label={auditPeriodLabel(period, mode, now)}
            onPick={(presetKey) => host.setQuery(auditPeriodQuery(query, presetKey))}
          />
        </HStack>

        {logsView === "loading" && <SettingsRowsSkeleton rows={8} />}
        {logsView === "empty" && (
          <Box width="full">
            <NoDataInfoBlock
              title="No audit logs found"
              description="Nothing was recorded for these filters. Try a wider date range or clear a filter."
              icon={<ScrollText size={24} />}
            />
          </Box>
        )}
        {logsView === "table" && (
          <>
            <Box
              width="full"
              overflowX="auto"
              borderWidth="1px"
              borderColor="border"
              borderRadius="lg"
            >
              <Table.Root variant="line" size="sm" width="full">
                <Table.Header>
                  <Table.Row bg="bg.subtle">
                    <Table.ColumnHeader width="8" paddingRight={0} />
                    <Table.ColumnHeader>Time</Table.ColumnHeader>
                    <Table.ColumnHeader>Actor</Table.ColumnHeader>
                    <Table.ColumnHeader>Action</Table.ColumnHeader>
                    {columns.target && <Table.ColumnHeader>Target</Table.ColumnHeader>}
                    {columns.project && <Table.ColumnHeader>Project</Table.ColumnHeader>}
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {groupAuditRuns(rows).map((run) => (
                    <AuditLogRunRow
                      key={run.id}
                      run={run}
                      columns={columns}
                      projectLabel={projectLabel}
                      projectSlug={scope.projectSlug}
                      scopeProjectId={scope.projectId ?? void 0}
                    />
                  ))}
                </Table.Body>
              </Table.Root>
            </Box>

            {totalHits > 0 && (
              <AuditPaginationFooter
                totalHits={totalHits}
                pageOffset={pageOffset}
                pageSize={pageSize}
                nextPage={() => host.setQuery(withAuditPageOffset(query, pageOffset + pageSize))}
                prevPage={() => host.setQuery(withAuditPageOffset(query, pageOffset - pageSize))}
                changePageSize={(size) => host.setQuery(withAuditPageSize(query, size))}
              />
            )}
          </>
        )}
      </VStack>
    </>
  );
}
