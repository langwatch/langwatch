import {
  Card,
  Field,
  HStack,
  Heading,
  Input,
  NativeSelect,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Search } from "react-feather";
import { useState } from "react";
import { useRouter } from "next/router";
import SettingsLayout from "../../components/SettingsLayout";
import { ProjectSelector } from "../../components/DashboardLayout";
import { InputGroup } from "../../components/ui/input-group";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { MessagesNavigationFooter } from "../../components/messages/MessagesNavigationFooter";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { formatDistanceToNow } from "date-fns";

function AuditLogPage() {
  const { organization, project, organizations } = useOrganizationTeamProject();
  const router = useRouter();

  // Get pagination from URL parameters with defaults
  const pageOffsetParam = router.query.pageOffset as string | undefined;
  const pageSizeParam = router.query.pageSize as string | undefined;
  const pageOffset = pageOffsetParam
    ? isNaN(Number(pageOffsetParam))
      ? 0
      : Number(pageOffsetParam)
    : 0;
  const pageSize = pageSizeParam
    ? isNaN(Number(pageSizeParam))
      ? 25
      : Number(pageSizeParam)
    : 25;

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

  // Extract organizationId with fallback for TypeScript
  const organizationId = organization?.id ?? "";

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
          {organizations && project && (
            <ProjectSelector organizations={organizations} project={project} />
          )}
        </HStack>

        <Text color="gray.600">
          View all audit logs for your organization. Filter by project, user, or
          action type.
        </Text>

        {/* Filters */}
        <Card.Root width="full">
          <Card.Body width="full" paddingY={4} paddingX={4}>
            <HStack gap={4} width="full" flexWrap="wrap">
              <Field.Root width="full" maxWidth="300px">
                <Field.Label>Search by User</Field.Label>
                <InputGroup startElement={<Search size={16} />}>
                  <Input
                    placeholder="Search by name or email..."
                    value={userSearch}
                    onChange={(e) => handleUserSearchChange(e.target.value)}
                  />
                </InputGroup>
              </Field.Root>

              <Field.Root width="full" maxWidth="300px">
                <Field.Label>Filter by Action</Field.Label>
                <Input
                  placeholder="Filter by action type..."
                  value={actionFilter}
                  onChange={(e) => handleActionFilterChange(e.target.value)}
                />
              </Field.Root>

              <Field.Root width="full" maxWidth="200px">
                <Field.Label>Project</Field.Label>
                <NativeSelect.Root size="sm">
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
              </Field.Root>
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
