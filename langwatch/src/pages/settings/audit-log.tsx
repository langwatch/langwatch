import {
  Button,
  Card,
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
import { formatDistanceToNow } from "date-fns";
import { Download, Search } from "lucide-react";
import { useRouter } from "next/router";
import Parse from "papaparse";
import { useState } from "react";
import { ProjectSelector } from "../../components/DashboardLayout";
import { MessagesNavigationFooter } from "../../components/messages/MessagesNavigationFooter";
import {
  PeriodSelector,
  usePeriodSelector,
} from "../../components/PeriodSelector";
import SettingsLayout from "../../components/SettingsLayout";
import { InputGroup } from "../../components/ui/input-group";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";

function AuditLogPage() {
  const { organization, project, organizations } = useOrganizationTeamProject();
  const router = useRouter();

  // Date range selector
  const {
    period: { startDate, endDate },
  } = usePeriodSelector(30);

  // Helper to parse URL query param to number with default
  const parseQueryNumber = (
    param: string | undefined,
    defaultValue: number,
  ): number => {
    if (!param) return defaultValue;
    const parsed = Number(param);
    return isNaN(parsed) ? defaultValue : parsed;
  };

  // Get pagination from URL parameters with defaults
  const pageOffset = parseQueryNumber(
    router.query.pageOffset as string | undefined,
    0,
  );
  const pageSize = parseQueryNumber(
    router.query.pageSize as string | undefined,
    25,
  );

  // Search state
  const [userSearch, setUserSearch] = useState(
    (router.query.userSearch as string) ?? "",
  );
  const [actionFilter, setActionFilter] = useState(
    (router.query.actionFilter as string) ?? "",
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    project?.id ?? null,
  );
  const [isExporting, setIsExporting] = useState(false);

  // Extract organizationId with fallback for TypeScript
  const organizationId = organization?.id ?? "";

  // Initialize query client (must be before early return)
  const queryClient = api.useContext();

  // Get users for search - we'll search by user ID or name/email
  const { data: organizationMembers } =
    api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      {
        organizationId,
      },
      {
        enabled: !!organization,
      },
    );

  // Find user ID from search query (search by name or email)
  const searchUserId = userSearch
    ? organizationMembers?.members.find((member) => {
        const searchLower = userSearch.toLowerCase();
        const nameMatch =
          member.user.name?.toLowerCase().includes(searchLower) ?? false;
        const emailMatch =
          member.user.email?.toLowerCase().includes(searchLower) ?? false;
        return nameMatch || emailMatch;
      })?.userId
    : undefined;

  // Fetch audit logs
  const { data: auditLogsData, isLoading } =
    api.organization.getAuditLogs.useQuery(
      {
        organizationId,
        projectId: selectedProjectId ?? undefined,
        userId: searchUserId,
        pageOffset,
        pageSize,
        action: actionFilter || undefined,
        startDate: startDate.getTime(),
        endDate: endDate.getTime(),
      },
      {
        enabled: !!organization,
      },
    );

  if (!organization) {
    return (
      <SettingsLayout>
        <VStack align="center" justify="center" width="full" height="200px">
          <Spinner />
        </VStack>
      </SettingsLayout>
    );
  }

  const updateQueryParams = (updates: Record<string, string | number>) => {
    void router.push({
      pathname: router.pathname,
      query: {
        ...router.query,
        ...updates,
        pageOffset: 0, // Reset to first page when filters change
      },
    });
  };

  const handleUserSearchChange = (value: string) => {
    setUserSearch(value);
    updateQueryParams({ userSearch: value });
  };

  const handleActionFilterChange = (value: string) => {
    setActionFilter(value);
    updateQueryParams({ actionFilter: value });
  };

  const handleProjectChange = (newProjectId: string | null) => {
    setSelectedProjectId(newProjectId);
    updateQueryParams({
      projectId: newProjectId ?? "",
    });
  };

  const nextPage = () => {
    const newOffset = pageOffset + pageSize;
    void router.push({
      pathname: router.pathname,
      query: { ...router.query, pageOffset: newOffset.toString() },
    });
  };

  const prevPage = () => {
    if (pageOffset > 0) {
      const newOffset = pageOffset - pageSize;
      void router.push({
        pathname: router.pathname,
        query: { ...router.query, pageOffset: newOffset.toString() },
      });
    }
  };

  const changePageSize = (size: number) => {
    void router.push({
      pathname: router.pathname,
      query: {
        ...router.query,
        pageSize: size.toString(),
        pageOffset: "0",
      },
    });
  };

  const totalHits = auditLogsData?.totalCount ?? 0;
  const auditLogs = auditLogsData?.auditLogs ?? [];

  const downloadCSV = async () => {
    if (!organization) return;

    setIsExporting(true);
    try {
      const allAuditLogs = [];
      let currentOffset = 0;
      const batchSize = 5000;
      let totalCount = 0;

      // Fetch first batch to get total count
      const initialBatch = await queryClient.organization.getAuditLogs.fetch({
        organizationId: organization.id,
        projectId: selectedProjectId ?? undefined,
        userId: searchUserId,
        pageOffset: 0,
        pageSize: batchSize,
        action: actionFilter || undefined,
        startDate: startDate.getTime(),
        endDate: endDate.getTime(),
      });

      allAuditLogs.push(...(initialBatch.auditLogs ?? []));
      totalCount = initialBatch.totalCount;
      currentOffset = batchSize;

      // Loop through remaining pages
      while (currentOffset < totalCount) {
        const batch = await queryClient.organization.getAuditLogs.fetch({
          organizationId: organization.id,
          projectId: selectedProjectId ?? undefined,
          userId: searchUserId,
          pageOffset: currentOffset,
          pageSize: batchSize,
          action: actionFilter || undefined,
          startDate: startDate.getTime(),
          endDate: endDate.getTime(),
        });

        if (!batch.auditLogs || batch.auditLogs.length === 0) break;

        allAuditLogs.push(...batch.auditLogs);
        currentOffset += batchSize;
      }

      // Define CSV fields
      const fields = [
        "Timestamp",
        "User Name",
        "User Email",
        "Action",
        "Project",
        "IP Address",
        "User Agent",
        "Error",
        "Args",
      ];

      // Convert audit logs to CSV rows
      const csvData = allAuditLogs.map((log) => [
        new Date(log.createdAt).toISOString(),
        (log as any).user?.name ?? "",
        (log as any).user?.email ?? "",
        log.action,
        (log as any).project?.name ?? log.projectId ?? "",
        log.ipAddress ?? "",
        log.userAgent ?? "",
        log.error ?? "",
        log.args ? JSON.stringify(log.args) : "",
      ]);

      // Generate CSV
      const csvBlob = Parse.unparse({
        fields,
        data: csvData,
      });

      // Create download link
      const url = window.URL.createObjectURL(new Blob([csvBlob]));
      const link = document.createElement("a");
      link.href = url;
      const today = new Date();
      const formattedDate = today.toISOString().split("T")[0];
      const fileName = `audit_logs_${formattedDate}.csv`;
      link.setAttribute("download", fileName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to export audit logs:", error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <SettingsLayout>
      <VStack
        paddingX={4}
        paddingY={6}
        gap={6}
        width="full"
        maxWidth="1200px"
        align="start"
      >
        <HStack width="full" marginTop={2}>
          <Heading size="lg" as="h1">
            Audit Log
          </Heading>
          <Spacer />
          <Button
            colorPalette="black"
            minWidth="fit-content"
            variant="ghost"
            onClick={() => void downloadCSV()}
            disabled={isExporting}
          >
            {isExporting ? (
              <>
                <Spinner size="sm" style={{ marginRight: "8px" }} />
                Exporting...
              </>
            ) : (
              <>
                Export CSV <Download style={{ marginLeft: "8px" }} />
              </>
            )}
          </Button>
          {organizations && project && (
            <ProjectSelector organizations={organizations} project={project} />
          )}
        </HStack>

        <Text color="gray.600">
          View all audit logs for your organization. Filter by project, user,
          action type, or date range.
        </Text>

        {/* Filters */}
        <Card.Root width="full">
          <Card.Body width="full" paddingY={4} paddingX={4}>
            <HStack gap={4} width="full" flexWrap="wrap" align="end">
              <VStack
                align="start"
                gap={1}
                flex="1"
                minWidth="200px"
                maxWidth="300px"
              >
                <Text fontSize="sm" fontWeight="medium" color="fg.muted">
                  Search by User
                </Text>
                <InputGroup startElement={<Search size={16} />} width="full">
                  <Input
                    placeholder="Search by name or email..."
                    value={userSearch}
                    onChange={(e) => handleUserSearchChange(e.target.value)}
                    width="full"
                  />
                </InputGroup>
              </VStack>

              <VStack
                align="start"
                gap={1}
                flex="1"
                minWidth="200px"
                maxWidth="300px"
              >
                <Text fontSize="sm" fontWeight="medium" color="fg.muted">
                  Filter by Action
                </Text>
                <Input
                  placeholder="Filter by action type..."
                  value={actionFilter}
                  onChange={(e) => handleActionFilterChange(e.target.value)}
                  width="full"
                />
              </VStack>

              <VStack
                align="start"
                gap={1}
                flex="1"
                minWidth="150px"
                maxWidth="200px"
              >
                <Text fontSize="sm" fontWeight="medium" color="fg.muted">
                  Project
                </Text>
                <NativeSelect.Root size="sm" width="full">
                  <NativeSelect.Field
                    value={selectedProjectId ?? "all"}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                      handleProjectChange(
                        e.target.value === "all" ? null : e.target.value,
                      )
                    }
                  >
                    <option value="all">All Projects</option>
                    {organization.teams
                      .flatMap((team) => team.projects)
                      .map((proj) => (
                        <option key={proj.id} value={proj.id}>
                          {proj.name}
                        </option>
                      ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </VStack>

              <VStack
                align="start"
                gap={1}
                flex="1"
                minWidth="200px"
                maxWidth="300px"
              >
                <Text fontSize="sm" fontWeight="medium" color="fg.muted">
                  Select Date
                </Text>
                <PeriodSelector
                  period={{ startDate, endDate }}
                  setPeriod={(start, end) => {
                    void router.push({
                      pathname: router.pathname,
                      query: {
                        ...router.query,
                        startDate: start.toISOString(),
                        endDate: end.toISOString(),
                        pageOffset: 0,
                      },
                    });
                  }}
                />
              </VStack>
            </HStack>
          </Card.Body>
        </Card.Root>

        {/* Audit Logs Table */}
        <Card.Root width="full">
          <Card.Body width="full" paddingY={0} paddingX={0}>
            {isLoading ? (
              <VStack padding={8}>
                <Spinner />
                <Text>Loading audit logs...</Text>
              </VStack>
            ) : auditLogs.length === 0 ? (
              <VStack padding={8}>
                <Text color="gray.500">No audit logs found</Text>
              </VStack>
            ) : (
              <>
                <Table.Root variant="line" width="full">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>Timestamp</Table.ColumnHeader>
                      <Table.ColumnHeader>User</Table.ColumnHeader>
                      <Table.ColumnHeader>Action</Table.ColumnHeader>
                      <Table.ColumnHeader>Project</Table.ColumnHeader>
                      <Table.ColumnHeader>IP Address</Table.ColumnHeader>
                      <Table.ColumnHeader>Error</Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {auditLogs.map((log) => (
                      <Table.Row key={log.id}>
                        <Table.Cell>
                          <VStack align="start" gap={0}>
                            <Text fontSize="sm">
                              {new Date(log.createdAt).toLocaleString()}
                            </Text>
                            <Text fontSize="xs" color="gray.500">
                              {formatDistanceToNow(new Date(log.createdAt), {
                                addSuffix: true,
                              })}
                            </Text>
                          </VStack>
                        </Table.Cell>
                        <Table.Cell>
                          {log.user ? (
                            <VStack align="start" gap={0}>
                              <Text fontSize="sm" fontWeight="medium">
                                {log.user.name ?? "Unknown"}
                              </Text>
                              <Text fontSize="xs" color="gray.500">
                                {log.user.email}
                              </Text>
                            </VStack>
                          ) : (
                            <Text fontSize="sm" color="gray.400">
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
                          {log.projectId ? (
                            (() => {
                              const project = organization.teams
                                .flatMap((team) => team.projects)
                                .find((p) => p.id === log.projectId);
                              return (
                                <Text fontSize="sm">
                                  {project?.name ?? log.projectId}
                                </Text>
                              );
                            })()
                          ) : (
                            <Text fontSize="sm" color="gray.400">
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
                            <Text fontSize="sm" color="gray.400">
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
                            <Text fontSize="sm" color="gray.400">
                              —
                            </Text>
                          )}
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>

                {/* Pagination */}
                {totalHits > 0 && (
                  <MessagesNavigationFooter
                    totalHits={totalHits}
                    pageOffset={pageOffset}
                    pageSize={pageSize}
                    nextPage={nextPage}
                    prevPage={prevPage}
                    changePageSize={changePageSize}
                  />
                )}
              </>
            )}
          </Card.Body>
        </Card.Root>
      </VStack>
    </SettingsLayout>
  );
}

export default withPermissionGuard("organization:view", {
  layoutComponent: SettingsLayout,
})(AuditLogPage);
