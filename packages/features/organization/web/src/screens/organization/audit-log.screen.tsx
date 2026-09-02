/**
 * The organization's audit trail, at `/settings/audit-log`.
 *
 * ONE TABLE OVER TWO WRITE SHAPES. Gateway mutations (virtual keys, budgets,
 * provider bindings, cache rules) and platform ones (members, settings, RBAC,
 * billing) land in the same `AuditLog` table; `source` is computed from whether
 * the row carries a `targetKind`, and the Source badge is how a reader tells
 * them apart at a glance.
 *
 * EVERY FILTER LIVES IN THE URL, which is the whole point of the surface: a
 * compliance reviewer's workflow is sending somebody else the exact view they
 * are looking at. The reading and the writes are pure functions in
 * `model/audit-log-filters.ts`; this screen only decides what to render.
 *
 * WHAT IS ENTERPRISE HERE IS THE READ, not the page. A reader below the plan
 * gets the page and a straight answer about what it would show, because hiding
 * a paid capability makes it look missing rather than purchasable.
 */

import {
  Alert,
  Badge,
  Box,
  Heading,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { InputGroup } from "@langwatch/design-system/input-group";
import { ContactSalesBlock } from "@langwatch/enterprise-billing-web";
import type { EnrichedAuditLog } from "@langwatch/organization-contract";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, Download, Search } from "lucide-react";
import Parse from "papaparse";
import { useMemo, useState } from "react";
import { organizationApi, type AuditLogFilters } from "../../behavior/organization-api";
import {
  auditLogCsvTable,
  auditLogExportOffsets,
  auditLogFileName,
  AUDIT_LOG_EXPORT_BATCH_SIZE,
} from "../../model/audit-log-export";
import {
  auditBackLink,
  matchMemberId,
  readAuditPaging,
  readAuditTarget,
  withAuditFilter,
  withAuditPageOffset,
  withAuditPageSize,
  withoutAuditTarget,
} from "../../model/audit-log-filters";
import { auditPeriodLabel, auditPeriodQuery, readAuditPeriod } from "../../model/audit-period";
import { disambiguateLabels } from "../../model/disambiguate-labels";
import { useOrganizationHost } from "../../model/organization-host";
import { AuditPaginationFooter } from "../../ui/elements/audit-pagination-footer";
import { AuditPeriodPicker } from "../../ui/elements/audit-period-picker";
import { Link } from "../../ui/elements/organization-link";

/**
 * The grant the page carries.
 *
 * `organization:manage` one for one with the platform page's
 * `withPermissionGuard`. The audit trail names who did what from every address
 * in the organization, so it is an administrator's surface rather than a
 * member's, and the refusal is a page-level one rather than a per-control one.
 */
export const AUDIT_LOG_PAGE_PERMISSION = "organization:manage";

/** The grant the plan read is gated on, matching what every plan reader asks. */
const ORGANIZATION_VIEW_PERMISSION = "organization:view";

export default function AuditLogScreen() {
  const host = useOrganizationHost();
  const scope = host.scope();
  const organization = host.organization();
  const { query } = host.route();
  const organizationId = scope.organizationId ?? "";

  const now = useMemo(() => new Date(), []);
  const { period, mode } = readAuditPeriod(query, now);
  const { pageOffset, pageSize } = readAuditPaging(query);
  const target = readAuditTarget(query);

  const [userSearch, setUserSearch] = useState(query.userSearch ?? "");
  const [actionFilter, setActionFilter] = useState(query.actionFilter ?? "");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    scope.projectId ?? null,
  );
  const [isExporting, setIsExporting] = useState(false);

  const usage = organizationApi.limits.getUsage.useQuery(
    { organizationId },
    {
      enabled: !!organizationId && host.hasPermission(ORGANIZATION_VIEW_PERMISSION),
      retry: false,
    },
  );
  const isEnterprise = usage.data?.activePlan.type === "ENTERPRISE";

  const members = organizationApi.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
    { organizationId },
    { enabled: !!organizationId },
  );
  const searchUserId = matchMemberId(members.data?.members ?? [], userSearch);

  const filters: AuditLogFilters = {
    organizationId,
    projectId: selectedProjectId ?? void 0,
    userId: searchUserId,
    action: actionFilter || void 0,
    startDate: period.startDate.getTime(),
    endDate: period.endDate.getTime(),
    targetKind: target?.targetKind,
    targetId: target?.targetId,
  };

  const auditLogs = organizationApi.organization.getAuditLogs.useQuery(
    { ...filters, pageOffset, pageSize },
    { enabled: !!organizationId && isEnterprise },
  );

  const utils = organizationApi.useUtils();

  if (!organizationId || usage.isLoading) {
    return (
      <VStack align="center" justify="center" width="full" height="200px">
        <Spinner />
      </VStack>
    );
  }

  if (!isEnterprise) {
    return (
      <VStack gap={6} width="full" align="start">
        <Alert.Root status="info">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Enterprise Feature</Alert.Title>
            <Alert.Description>
              Organisation-wide audit logs — including AI Gateway events (virtual-key / budget /
              provider / cache-rule mutations) alongside logins, member changes, settings, RBAC, and
              billing — are available on Enterprise plans. Contact sales to upgrade.
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
        <Box width="full">
          <ContactSalesBlock />
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
   * The whole filtered history, walked in batches and handed over as one file.
   *
   * `filters` is the SAME object the table above is reading with, which is the
   * property that makes an export from a deep-link honest: it cannot widen.
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

      host.download({
        fileName: auditLogFileName(new Date()),
        contents: Parse.unparse(auditLogCsvTable(collected)),
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
    <VStack gap={6} width="full" align="start">
      <HStack width="full" marginTop={2}>
        <VStack align="start" gap={1}>
          {backLink && (
            <Link href={backLink.href} color="fg.muted" fontSize="sm">
              <HStack gap={1}>
                <ArrowLeft size={14} /> {backLink.label}
              </HStack>
            </Link>
          )}
          <Heading as="h2">Audit Log</Heading>
          <Text color="fg.muted">
            View all audit logs for your organization. Filter by project, user, action type, or date
            range.
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
        <Spacer />
        {host.projectSwitcher()}
      </HStack>

      <HStack gap={4} width="full" flexWrap="wrap" align="end">
        <VStack align="start" gap={1} flex="1" minWidth="200px" maxWidth="300px">
          <Text fontSize="sm" fontWeight="medium" color="fg.muted">
            Search by User
          </Text>
          <InputGroup startElement={<Search size={16} />} width="full">
            <Input
              placeholder="Search by name or email..."
              aria-label="Search by User"
              value={userSearch}
              onChange={(event) => handleUserSearchChange(event.target.value)}
              width="full"
            />
          </InputGroup>
        </VStack>

        <VStack align="start" gap={1} flex="1" minWidth="200px" maxWidth="300px">
          <Text fontSize="sm" fontWeight="medium" color="fg.muted">
            Filter by Action
          </Text>
          <Input
            placeholder="Filter by action type..."
            aria-label="Filter by Action"
            value={actionFilter}
            onChange={(event) => handleActionFilterChange(event.target.value)}
            width="full"
          />
        </VStack>

        <VStack align="start" gap={1} flex="1" minWidth="150px" maxWidth="200px">
          <Text fontSize="sm" fontWeight="medium" color="fg.muted">
            Project
          </Text>
          <NativeSelect.Root size="sm" width="full">
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
        </VStack>

        <VStack align="start" gap={1} flex="1" minWidth="200px" maxWidth="300px">
          <Text fontSize="sm" fontWeight="medium" color="fg.muted">
            Select Date
          </Text>
          <AuditPeriodPicker
            label={auditPeriodLabel(period, mode, now)}
            onPick={(presetKey) => host.setQuery(auditPeriodQuery(query, presetKey))}
          />
        </VStack>

        <PageLayout.HeaderButton onClick={() => void downloadCsv()} disabled={isExporting}>
          <Download />
          Export CSV
        </PageLayout.HeaderButton>
      </HStack>

      {auditLogs.isLoading ? (
        <VStack padding={8}>
          <Spinner />
          <Text>Loading audit logs...</Text>
        </VStack>
      ) : rows.length === 0 ? (
        <VStack padding={8}>
          <Text color="fg.muted">No audit logs found</Text>
        </VStack>
      ) : (
        <>
          <Box width="full" overflowX="auto">
            <Table.Root variant="line" width="full">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Timestamp</Table.ColumnHeader>
                  <Table.ColumnHeader>Source</Table.ColumnHeader>
                  <Table.ColumnHeader>User</Table.ColumnHeader>
                  <Table.ColumnHeader>Action</Table.ColumnHeader>
                  <Table.ColumnHeader>Target</Table.ColumnHeader>
                  <Table.ColumnHeader>Project</Table.ColumnHeader>
                  <Table.ColumnHeader>IP Address</Table.ColumnHeader>
                  <Table.ColumnHeader>Error</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {rows.map((log) => (
                  <Table.Row key={log.id}>
                    <Table.Cell>
                      <VStack align="start" gap={0}>
                        <Text fontSize="sm">{new Date(log.createdAt).toLocaleString()}</Text>
                        <Text fontSize="xs" color="fg.muted">
                          {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                        </Text>
                      </VStack>
                    </Table.Cell>
                    <Table.Cell>
                      <Badge
                        size="sm"
                        variant="subtle"
                        colorPalette={log.source === "gateway" ? "purple" : "gray"}
                      >
                        {log.source === "gateway" ? "Gateway" : "Platform"}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      {log.user ? (
                        <VStack align="start" gap={0}>
                          <Text fontSize="sm" fontWeight="medium">
                            {log.user.name ?? "Unknown"}
                          </Text>
                          <Text fontSize="xs" color="fg.muted">
                            {log.user.email}
                          </Text>
                        </VStack>
                      ) : (
                        <Text fontSize="sm" color="fg.subtle">
                          User not found
                        </Text>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      <Text fontSize="sm" fontFamily="mono">
                        {log.action}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      {log.targetKind && log.targetId ? (
                        <VStack align="start" gap={0}>
                          <Text fontSize="xs" color="fg.muted">
                            {log.targetKind}
                          </Text>
                          <Text fontSize="xs" fontFamily="mono">
                            {log.targetId.slice(0, 16)}…
                          </Text>
                        </VStack>
                      ) : (
                        <Text fontSize="sm" color="fg.subtle">
                          —
                        </Text>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      {log.projectId ? (
                        <Text fontSize="sm">
                          {projects.find((project) => project.id === log.projectId)?.label ??
                            log.projectId}
                        </Text>
                      ) : (
                        <Text fontSize="sm" color="fg.subtle">
                          —
                        </Text>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      {log.ipAddress ? (
                        <Text fontSize="sm" fontFamily="mono">
                          {log.ipAddress}
                        </Text>
                      ) : (
                        <Text fontSize="sm" color="fg.subtle">
                          —
                        </Text>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      {log.error ? (
                        <Text fontSize="sm" color="red.600">
                          {log.error}
                        </Text>
                      ) : (
                        <Text fontSize="sm" color="fg.subtle">
                          —
                        </Text>
                      )}
                    </Table.Cell>
                  </Table.Row>
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
  );
}
