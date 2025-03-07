import {
  Box,
  Button,
  Container,
  Heading,
  HStack,
  Spacer,
  Spinner,
  Text,
  VStack,
  Skeleton,
  Card,
} from "@chakra-ui/react";
import { Plus, Play } from "react-feather";
import { DashboardLayout } from "../../components/DashboardLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { TeamRoleGroup } from "../../server/api/permission";
import { toaster } from "../../components/ui/toaster";
import { Link } from "../../components/ui/link";
import { MonitorsSection } from "../../components/evaluations/MonitorsSection";
import { useRouter } from "next/router";
import { useDrawer } from "~/components/CurrentDrawer";
import { Table } from "@chakra-ui/react";

export default function EvaluationsV2() {
  const { project, hasTeamPermission } = useOrganizationTeamProject();
  const router = useRouter();
  const { openDrawer } = useDrawer();

  const checks = api.checks.getAllForProject.useQuery(
    {
      projectId: project?.id ?? "",
    },
    { enabled: !!project }
  );

  const experiments = api.experiments.getAllByProjectId.useQuery(
    {
      projectId: project?.id ?? "",
    },
    { enabled: !!project }
  );

  if (!project) return null;

  const handleNewEvaluation = () => {
    void router.push(`/${project.slug}/evaluations/new/choose`);
  };

  const handleEditMonitor = (monitorId: string) => {
    void router.push(`/${project.slug}/evaluations/${monitorId}/edit`);
  };

  // Transform checks data into monitor format
  const guardrails = checks.data
    ?.filter((check) => check.executionMode === "AS_GUARDRAIL")
    .map((check) => ({
      id: check.id,
      name: check.name,
      type: "boolean",
      metric: "Pass Rate",
      value: 0.95, // TODO: Get real value from metrics
      status: "healthy" as const,
      lastUpdated: "2 min ago", // TODO: Get real timestamp
      history: [
        { time: "1", value: 0.92 },
        { time: "2", value: 0.95 },
        { time: "3", value: 0.97 },
        { time: "4", value: 0.96 },
        { time: "5", value: 0.95 },
        { time: "6", value: 0.99 },
        { time: "7", value: 0.95 },
      ],
    })) ?? [];

  const monitors = checks.data
    ?.filter((check) => check.executionMode !== "AS_GUARDRAIL")
    .map((check) => ({
      id: check.id,
      name: check.name,
      type: "boolean",
      metric: "Pass Rate",
      value: 0.87, // TODO: Get real value from metrics
      status: "healthy" as const,
      lastUpdated: "5 min ago", // TODO: Get real timestamp
      history: [
        { time: "1", value: 0.82 },
        { time: "2", value: 0.84 },
        { time: "3", value: 0.81 },
        { time: "4", value: 0.85 },
        { time: "5", value: 0.86 },
        { time: "6", value: 0.87 },
        { time: "7", value: 0.87 },
      ],
    })) ?? [];

  return (
    <DashboardLayout>
      <Container maxWidth="1200" padding={6}>
        <VStack width="fill" gap={4} align="stretch">
          <HStack paddingTop={4}>
            <VStack align="start" gap={1}>
              <Heading as="h1">Evaluations Dashboard</Heading>
              <Text color="gray.600">
                Monitor real-time performance metrics and batch evaluation results
              </Text>
            </VStack>
            <Spacer />
            <HStack gap={2}>
              {hasTeamPermission(TeamRoleGroup.GUARDRAILS_MANAGE) && (
                <Link asChild href={`/${project.slug}/evaluations/new/choose`}>
                  <Button colorPalette="orange">
                    <Plus size={16} /> New Evaluation
                  </Button>
                </Link>
              )}
              <Button
                colorPalette="blue"
                onClick={() => {
                  openDrawer("batchEvaluation", {
                    selectDataset: true,
                  });
                }}
                minWidth="fit-content"
              >
                <Play size={16} /> Batch Evaluation
              </Button>
            </HStack>
          </HStack>

          {checks.isLoading ? (
            <Box display="flex" justifyContent="center" py={8}>
              <Spinner />
            </Box>
          ) : checks.isError ? (
            <Box>
              <Text color="red.500">Error loading evaluations</Text>
            </Box>
          ) : (
            <>
              <MonitorsSection
                title="Active Guardrails"
                description="Real-time evaluation systems that block or flag messages"
                monitors={guardrails}
                onEditMonitor={handleEditMonitor}
              />

              <MonitorsSection
                title="Active Monitors"
                description="Post-execution evaluation systems that analyze results"
                monitors={monitors}
                onEditMonitor={handleEditMonitor}
              />

              <Card.Root>
                <Card.Body>
                  <VStack align="start" gap={4}>
                    <HStack width="full" justify="space-between">
                      <VStack align="start" gap={1}>
                        <Heading size="md">Experiments</Heading>
                        <Text color="gray.600">
                          View and analyze your model evaluation results
                        </Text>
                      </VStack>
                    </HStack>

                    <Table.Root variant="line" width="full">
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeader>Experiment</Table.ColumnHeader>
                          <Table.ColumnHeader>Type</Table.ColumnHeader>
                          <Table.ColumnHeader>Created At</Table.ColumnHeader>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {experiments.isLoading
                          ? Array.from({ length: 3 }).map((_, i) => (
                              <Table.Row key={i}>
                                {Array.from({ length: 3 }).map((_, i) => (
                                  <Table.Cell key={i}>
                                    <Skeleton height="20px" />
                                  </Table.Cell>
                                ))}
                              </Table.Row>
                            ))
                          : experiments.data
                          ? experiments.data?.map((experiment, i) => (
                              <Table.Row
                                cursor="pointer"
                                onClick={() => {
                                  void router.push({
                                    pathname: `/${project?.slug}/experiments/${experiment.slug}`,
                                  });
                                }}
                                key={i}
                              >
                                <Table.Cell>{experiment.name ?? experiment.slug}</Table.Cell>
                                <Table.Cell>{experiment.type}</Table.Cell>
                                <Table.Cell>{experiment.createdAt.toLocaleString()}</Table.Cell>
                              </Table.Row>
                            ))
                          : null}
                      </Table.Body>
                    </Table.Root>
                  </VStack>
                </Card.Body>
              </Card.Root>
            </>
          )}
        </VStack>
      </Container>
    </DashboardLayout>
  );
}
