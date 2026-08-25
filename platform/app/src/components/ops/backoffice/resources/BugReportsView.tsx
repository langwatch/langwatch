import {
  Badge,
  Box,
  Button,
  HStack,
  SimpleGrid,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Copy, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { useDebounce } from "use-debounce";
import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { EmptyCell, formatDateTime } from "@langwatch/ops-web";
import { BackofficeTable } from "../BackofficeTable";

const PAGE_SIZE = 25;

const kindLabel: Record<string, string> = {
  summary: "Summary",
  full_session: "Full session",
};

/**
 * The global inbox of issue reports sent by customers' coding agents through
 * `langwatch report` and the MCP report tool. Read-only: the value is reading
 * what agents struggled with, transcript included.
 */
export default function BugReportsView() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [page, setPage] = useState(1);
  const openReportId =
    typeof router.query.report === "string" ? router.query.report : null;

  const list = api.bugReports.getAll.useQuery({
    page: page - 1,
    pageSize: PAGE_SIZE,
    search: debouncedSearch.trim() || undefined,
  });

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const setOpenReport = (reportId: string | null) => {
    const query = { ...router.query } as Record<string, unknown>;
    if (reportId) {
      query.report = reportId;
    } else {
      delete query.report;
    }
    void router.replace({ query }, undefined, { shallow: true });
  };

  return (
    <>
      <BackofficeTable
        title="Bug Reports"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search title, summary, agent, contact, project"
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.error as Error | null}
        pagination={{
          page,
          perPage: PAGE_SIZE,
          total: list.data?.total ?? 0,
          onPageChange: setPage,
        }}
      >
        <BugReportsTable reports={list.data?.reports} onOpen={setOpenReport} />
      </BackofficeTable>

      <BugReportDrawer
        reportId={openReportId}
        onClose={() => setOpenReport(null)}
      />
    </>
  );
}

interface BugReportRow {
  id: string;
  createdAt: string | Date;
  source: string;
  kind: string;
  title: string;
  agent: string | null;
  linkedProjectId: string | null;
  contactEmail: string | null;
}

function BugReportsTable({
  reports,
  onOpen,
}: {
  reports: BugReportRow[] | undefined;
  onOpen: (reportId: string) => void;
}) {
  return (
    <Table.Root size="sm" variant="line">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Received</Table.ColumnHeader>
          <Table.ColumnHeader>Title</Table.ColumnHeader>
          <Table.ColumnHeader>Kind</Table.ColumnHeader>
          <Table.ColumnHeader>Agent</Table.ColumnHeader>
          <Table.ColumnHeader>Source</Table.ColumnHeader>
          <Table.ColumnHeader>Project</Table.ColumnHeader>
          <Table.ColumnHeader>Contact</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {reports?.length === 0 && (
          <Table.Row>
            <Table.Cell colSpan={7}>
              <Text color="fg.muted" paddingY={6} textAlign="center">
                No reports yet. They arrive here when a customer's coding agent
                runs `langwatch report`.
              </Text>
            </Table.Cell>
          </Table.Row>
        )}
        {reports?.map((report) => (
          <Table.Row
            key={report.id}
            cursor="pointer"
            _hover={{ backgroundColor: "bg.muted" }}
            onClick={() => onOpen(report.id)}
          >
            <Table.Cell whiteSpace="nowrap">
              {formatDateTime(report.createdAt)}
            </Table.Cell>
            <Table.Cell maxWidth="320px">
              <Button
                variant="plain"
                size="sm"
                paddingX={0}
                height="auto"
                fontWeight="medium"
                maxWidth="full"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpen(report.id);
                }}
              >
                <Text truncate>{report.title}</Text>
              </Button>
            </Table.Cell>
            <Table.Cell>
              <Badge
                colorPalette={
                  report.kind === "full_session" ? "purple" : "gray"
                }
              >
                {kindLabel[report.kind] ?? report.kind}
              </Badge>
            </Table.Cell>
            <Table.Cell>{report.agent ?? <EmptyCell />}</Table.Cell>
            <Table.Cell>{report.source}</Table.Cell>
            <Table.Cell>{report.linkedProjectId ?? <EmptyCell />}</Table.Cell>
            <Table.Cell>{report.contactEmail ?? <EmptyCell />}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}

function BugReportDrawer({
  reportId,
  onClose,
}: {
  reportId: string | null;
  onClose: () => void;
}) {
  const report = api.bugReports.getById.useQuery(
    { id: reportId ?? "" },
    { enabled: !!reportId, retry: false },
  );

  const downloadTranscript = () => {
    if (!report.data?.sessionData) return;
    const blob = new Blob([report.data.sessionData], {
      type: "application/jsonl",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `agent-report-${report.data.id}.jsonl`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const copyTranscript = async () => {
    if (!report.data?.sessionData) return;
    await navigator.clipboard.writeText(report.data.sessionData);
    toaster.create({ title: "Transcript copied", type: "success" });
  };

  return (
    <Drawer.Root
      open={!!reportId}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
      size="xl"
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{report.data?.title ?? "Bug report"}</Drawer.Title>
        </Drawer.Header>
        <Drawer.CloseTrigger />
        <Drawer.Body>
          {report.error && (
            <Text color="red.500" fontSize="sm">
              {report.error.message}
            </Text>
          )}
          {report.data && (
            <VStack align="stretch" gap={6}>
              <SimpleGrid columns={2} gap={3}>
                <Fact label="Received">
                  {formatDateTime(report.data.createdAt)}
                </Fact>
                <Fact label="Kind">
                  {kindLabel[report.data.kind] ?? report.data.kind}
                </Fact>
                <Fact label="Source">{report.data.source}</Fact>
                <Fact label="Agent">{report.data.agent ?? "unknown"}</Fact>
                <Fact label="CLI version">
                  {report.data.cliVersion ?? "unknown"}
                </Fact>
                <Fact label="Project">
                  {report.data.linkedProjectId ?? "not linked"}
                </Fact>
                <Fact label="Contact">
                  {report.data.contactEmail ?? "none"}
                </Fact>
                <Fact label="Transcript">
                  {report.data.sessionData
                    ? report.data.sessionTruncated
                      ? "attached, truncated"
                      : "attached"
                    : "none"}
                </Fact>
              </SimpleGrid>

              {report.data.summary && (
                <Box>
                  <Text fontWeight="semibold" marginBottom={2}>
                    Summary
                  </Text>
                  <Box
                    backgroundColor="bg.muted"
                    borderRadius="md"
                    padding={3}
                    fontSize="sm"
                    whiteSpace="pre-wrap"
                    fontFamily="mono"
                  >
                    {report.data.summary}
                  </Box>
                </Box>
              )}

              {report.data.sessionData && (
                <Box>
                  <HStack marginBottom={2}>
                    <Text fontWeight="semibold">Session transcript</Text>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={copyTranscript}
                    >
                      <Copy size={12} /> Copy
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={downloadTranscript}
                    >
                      <Download size={12} /> Download .jsonl
                    </Button>
                  </HStack>
                  <Box
                    backgroundColor="bg.muted"
                    borderRadius="md"
                    padding={3}
                    fontSize="xs"
                    fontFamily="mono"
                    whiteSpace="pre-wrap"
                    wordBreak="break-all"
                    maxHeight="480px"
                    overflowY="auto"
                  >
                    {report.data.sessionData}
                  </Box>
                </Box>
              )}
            </VStack>
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Box>
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Text fontSize="sm">{children}</Text>
    </Box>
  );
}
