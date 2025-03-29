import {
  Box,
  Button,
  Card,
  Container,
  EmptyState,
  Heading,
  HStack,
  Skeleton,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import { Play, Plus } from "react-feather";
import { useDrawer } from "~/components/CurrentDrawer";
import { DashboardLayout } from "../../components/DashboardLayout";
import { MonitorsSection } from "../../components/evaluations/MonitorsSection";
import { Link } from "../../components/ui/link";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { TeamRoleGroup } from "../../server/api/permission";
import { api } from "../../utils/api";
import { LuSquareCheckBig } from "react-icons/lu";

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

  const handleEditMonitor = (monitorId: string) => {
    void router.push(`/${project.slug}/evaluations/${monitorId}/edit`);
  };

  return (
    <DashboardLayout>
      <Container maxWidth="1200" padding={6}>
        <VStack width="fill" gap={4} align="stretch">
          <HStack paddingTop={4}>
            <VStack align="start" gap={1}>
              <Heading as="h1">Evaluations Dashboard</Heading>
              <Text color="gray.600">
                Monitor real-time performance metrics and batch evaluation
                results
              </Text>
            </VStack>
            <Spacer />
            <HStack gap={2}>
              {hasTeamPermission(TeamRoleGroup.GUARDRAILS_MANAGE) && (
                <Link asChild href={`/${project.slug}/evaluations/wizard`}>
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
                title="Active Monitors"
                evaluations={checks.data}
                onEditMonitor={handleEditMonitor}
              />

              <VStack align="start" gap={1}>
                <Heading as="h1">Evaluations</Heading>
                <Text color="gray.600">
                  View and analyze your evaluation results
                </Text>
              </VStack>

              <Card.Root>
                <Card.Body>
                  {experiments.data && experiments.data.length == 0 ? (
                    <EmptyState.Root>
                      <EmptyState.Content>
                        <EmptyState.Indicator>
                          <LuSquareCheckBig size={32} />
                        </EmptyState.Indicator>
                        <EmptyState.Title>No evaluations yet</EmptyState.Title>
                        <EmptyState.Description>
                          {project &&
                            hasTeamPermission(
                              TeamRoleGroup.GUARDRAILS_MANAGE
                            ) && (
                              <>
                                {" "}
                                Click on{" "}
                                <Link
                                  textDecoration="underline"
                                  href={`/${project.slug}/evaluations/wizard`}
                                >
                                  New Evaluation
                                </Link>{" "}
                                to get started.
                              </>
                            )}
                        </EmptyState.Description>
                      </EmptyState.Content>
                    </EmptyState.Root>
                  ) : (
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
                                <Table.Cell>
                                  {experiment.name ?? experiment.slug}
                                </Table.Cell>
                                <Table.Cell>{experiment.type}</Table.Cell>
                                <Table.Cell>
                                  {experiment.createdAt.toLocaleString()}
                                </Table.Cell>
                              </Table.Row>
                            ))
                          : null}
                      </Table.Body>
                    </Table.Root>
                  )}
                </Card.Body>
              </Card.Root>
            </>
          )}
        </VStack>
      </Container>
    </DashboardLayout>
  );
}
