import type { WireOf } from "@langwatch/api/web";
import { UpgradeRequired } from "@langwatch/design-system/access-state";
/**
 * The organization's audit trail, at `/settings/audit-log`. ONE TABLE OVER TWO WRITE SHAPES.
 */
import { InputGroup } from "@langwatch/design-system/input-group";
import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Button,
  Badge,
  Box,
  HStack,
  Input,
  Spacer,
  Table,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { ScopeChipPicker } from "@langwatch/design-system/scope-chip-picker";
import type { EnrichedAuditLog as StoredEnrichedAuditLog } from "@langwatch/organization-contract";

/** An audit row as the browser receives it: its instant is an ISO string. */
type EnrichedAuditLog = WireOf<StoredEnrichedAuditLog>;
import { neutralizeFormula, neutralizeRows } from "@langwatch/csv";
import { currentTimeZone, nowInstant, toDate, type Instant } from "@langwatch/time";
import { ArrowLeft, Download, ScrollText, Search } from "lucide-react";
import Parse from "papaparse";
import { useState } from "react";

import { organizationApi, type AuditLogFilters } from "../../../behavior/organization-api.ts";
import type { AuditExportWindow } from "../../../model/audit-export-range.ts";
import {
  auditLogCsvTable,
  auditLogExportOffsets,
  auditLogFileName,
  AUDIT_LOG_EXPORT_BATCH_SIZE,
} from "../../../model/audit-log-export.ts";
import {
  auditBackLink,
  matchMemberId,
  searchMatchesNobody,
  readAuditPaging,
  readAuditTarget,
  withAuditFilter,
  withAuditPageOffset,
  withAuditPageSize,
  withoutAuditTarget,
} from "../../../model/audit-log-filters.ts";
import { auditFeedDays } from "../../../model/audit-log-rows.ts";
import {
  auditPeriodLabel,
  auditPeriodQuery,
  readAuditPeriod,
} from "../../../model/audit-period.ts";
import { useOrganizationHost } from "../../../model/organization-host.ts";
import { AuditExportDialog } from "../../../ui/blocks/audit-export-dialog.tsx";
import {
  AUDIT_TABLE_COLUMNS,
  AUDIT_TABLE_MIN_WIDTH,
  AuditLogEntry,
  AuditTableHead,
} from "../../../ui/blocks/audit-log-entry.tsx";
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
}): "loading" | "empty" | "feed" {
  if (isLoading) return "loading";
  if (rowCount === 0) return "empty";
  return "feed";
}

const PERSONAL_GROUP = "personal-workspaces";

type GraphTeam = { id: string; name: string; projects: { id: string; name: string }[] };

/**
 * Teams with their projects for the project filter; personal workspaces gathered
 * under one group, each named for its owner. The host's team reading carries the
 * personal flags at runtime before its type does, so they are read structurally.
 */
function auditProjectTree({
  teams,
  ownerName,
}: {
  teams: readonly GraphTeam[];
  ownerName: (userId: string | null) => string | null;
}) {
  const personal = (team: GraphTeam) => "isPersonal" in team && team.isPersonal === true;
  const owner = (team: GraphTeam) =>
    "ownerUserId" in team && typeof team.ownerUserId === "string" ? team.ownerUserId : null;
  const projects = teams.flatMap((team) =>
    team.projects.map((project) => {
      if (!personal(team)) return { id: project.id, name: project.name, teamId: team.id };
      const workspace = `${ownerName(owner(team)) ?? team.name}'s workspace`;
      const name = team.projects.length > 1 ? `${workspace} · ${project.name}` : workspace;
      return { id: project.id, name, teamId: PERSONAL_GROUP };
    }),
  );
  return {
    teams: [
      ...teams.filter((team) => !personal(team)).map(({ id, name }) => ({ id, name })),
      ...(teams.some(personal) ? [{ id: PERSONAL_GROUP, name: "Personal workspaces" }] : []),
    ],
    projects,
  };
}

/** The first batch, then every later one until the history or the batches run out. */
async function collectAuditLogs<T>({
  first,
  fetchAt,
}: {
  first: { auditLogs?: T[] | null; totalCount: number };
  fetchAt: (offset: number) => Promise<{ auditLogs?: T[] | null }>;
}): Promise<T[]> {
  const collected = [...(first.auditLogs ?? [])];
  for (const offset of auditLogExportOffsets({ totalCount: first.totalCount })) {
    const batch = await fetchAt(offset);
    if (!batch.auditLogs || batch.auditLogs.length === 0) break;
    collected.push(...batch.auditLogs);
  }
  return collected;
}

/** A 28px band; the row's selector outweighs the table's default cell padding. */
const DAY_BAND = { "& > td": { height: "28px", paddingTop: 0, paddingBottom: 0 } } as const;

/** Filter controls share one 32px line, 13px text and a 4px radius. */
const FILTER_CONTROL = {
  height: "32px",
  fontSize: "13px",
  lineHeight: "20px",
  borderRadius: "4px",
};

/** The feed: one band per day (with the reader's zone), then that day's runs. */
function AuditFeed({
  rows,
  now,
  projectLabel,
}: {
  rows: EnrichedAuditLog[];
  now: Instant;
  projectLabel: (projectId: string) => string;
}) {
  return (
    <ListTable
      size="sm"
      density="compact"
      tableLayout="fixed"
      minWidth={AUDIT_TABLE_MIN_WIDTH}
      data-testid="audit-log-feed"
      containerProps={{ overflowX: "auto", width: "full" }}
    >
      <AuditTableHead />
      {auditFeedDays({ rows, now: toDate(now) }).map((day) => (
        <Table.Body key={day.heading} aria-label={day.label}>
          <Table.Row css={DAY_BAND}>
            <Table.Cell
              colSpan={AUDIT_TABLE_COLUMNS.length}
              bg="bg.muted"
              fontSize="xs"
              lineHeight="16px"
              fontWeight="medium"
              color="fg"
            >
              <HStack justify="flex-start" gap={3}>
                <Text>{day.heading}</Text>
                <Text color="fg.muted" fontWeight="normal">
                  {currentTimeZone()}
                </Text>
              </HStack>
            </Table.Cell>
          </Table.Row>
          {day.runs.map((run) => (
            <AuditLogEntry key={run.id} run={run} projectLabel={projectLabel} />
          ))}
        </Table.Body>
      ))}
    </ListTable>
  );
}

export default function AuditLogScreen() {
  const host = useOrganizationHost();
  const scope = host.scope();
  const organization = host.organization();
  const { query } = host.route();
  const organizationId = scope.organizationId ?? "";

  const [now] = useState(() => nowInstant());
  const { period, mode } = readAuditPeriod(query, now);
  const { pageOffset, pageSize } = readAuditPaging(query);
  const target = readAuditTarget(query);

  const [userSearch, setUserSearch] = useState(query.userSearch ?? "");
  const [actionFilter, setActionFilter] = useState(query.actionFilter ?? "");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    scope.projectId ?? null,
  );
  const [isExporting, setIsExporting] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);

  const isEnterprise = host.isEnterprise();

  const members = organizationApi.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
    { organizationId, includeDeactivated: false },
    { enabled: !!organizationId },
  );
  const searchUserId = matchMemberId(members.data?.members ?? [], userSearch);
  const matchesNobody = searchMatchesNobody(members.data?.members, userSearch);

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
    { enabled: !!organizationId && isEnterprise && !matchesNobody },
  );

  const utils = organizationApi.useUtils();

  if (!organizationId || host.isPlanLoading()) {
    return <SettingsRowsSkeleton rows={8} />;
  }

  if (!isEnterprise) {
    return (
      <VStack gap={6} width="full" align="start">
        <UpgradeRequired
          feature="Audit logs"
          actions={
            <Button asChild colorPalette="orange" size="sm">
              <Link href="/settings/plans">Compare plans</Link>
            </Button>
          }
        />
      </VStack>
    );
  }

  const feed = matchesNobody ? undefined : auditLogs.data;
  const rows: EnrichedAuditLog[] = feed?.auditLogs ?? [];
  const totalHits = feed?.totalCount ?? 0;
  const backLink = auditBackLink({ target, projectSlug: scope.projectSlug });
  const ownerName = (userId: string | null) => {
    const member = members.data?.members.find((candidate) => candidate.userId === userId);
    return member?.user.name ?? member?.user.email ?? null;
  };
  const scopeTree = auditProjectTree({ teams: organization?.teams ?? [], ownerName });

  const projectLabel = (projectId: string) =>
    scopeTree.projects.find((project) => project.id === projectId)?.name ?? projectId;

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
   * The filtered history over the chosen window, walked in batches as one file. Every filter
   * but the window is the SAME object the table reads with, so a deep-linked export never
   * widens past its target, user, action or project.
   */
  const downloadCsv = async (span: AuditExportWindow) => {
    setIsExporting(true);
    const exportFilters = { ...filters, ...span };
    try {
      const first = await utils.organization.getAuditLogs.fetch({
        ...exportFilters,
        pageOffset: 0,
        pageSize: AUDIT_LOG_EXPORT_BATCH_SIZE,
      });
      const collected = await collectAuditLogs({
        first,
        fetchAt: (offset) =>
          utils.organization.getAuditLogs.fetch({
            ...exportFilters,
            pageOffset: offset,
            pageSize: AUDIT_LOG_EXPORT_BATCH_SIZE,
          }),
      });

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
      setIsExportOpen(false);
    }
  };

  const appliedFilters = [
    searchUserId && userSearch ? `user ${userSearch}` : null,
    actionFilter ? `action ${actionFilter}` : null,
    selectedProjectId ? `project ${projectLabel(selectedProjectId)}` : null,
    target ? `${target.targetKind} ${target.targetId}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Audit Log</PageLayout.Heading>
        <Spacer />
        <PageLayout.HeaderButton
          onClick={() => setIsExportOpen(true)}
          disabled={isExporting || matchesNobody}
        >
          <Download />
          Export CSV
        </PageLayout.HeaderButton>
      </PageLayout.Header>

      <AuditExportDialog
        open={isExportOpen}
        view={period}
        now={now}
        appliedFilters={appliedFilters}
        isExporting={isExporting}
        onClose={() => setIsExportOpen(false)}
        onExport={(span) => void downloadCsv(span)}
      />

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
              {...FILTER_CONTROL}
              placeholder="Search by name or email..."
              aria-label="Search by User"
              value={userSearch}
              onChange={(event) => handleUserSearchChange(event.target.value)}
            />
          </InputGroup>
          <Input
            size="sm"
            {...FILTER_CONTROL}
            width="200px"
            placeholder="Filter by action..."
            aria-label="Filter by Action"
            value={actionFilter}
            onChange={(event) => handleActionFilterChange(event.target.value)}
          />
          <Box width="200px" data-testid="audit-project-filter">
            <ScopeChipPicker
              variant="single-select"
              size="sm"
              singleSelect
              label=""
              showSummary={false}
              allowedScopeTypes={["ORGANIZATION", "PROJECT"]}
              organizationId={organizationId}
              organizationName="All projects"
              availableTeams={scopeTree.teams}
              availableProjects={scopeTree.projects}
              value={[
                selectedProjectId
                  ? { scopeType: "PROJECT", scopeId: selectedProjectId }
                  : { scopeType: "ORGANIZATION", scopeId: organizationId },
              ]}
              onChange={(next) =>
                handleProjectChange(next[0]?.scopeType === "PROJECT" ? next[0].scopeId : null)
              }
            />
          </Box>
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
        {logsView === "feed" && (
          <>
            <Box width="full">
              <AuditFeed rows={rows} now={now} projectLabel={projectLabel} />
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
