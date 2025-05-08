import {
  Badge,
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
import type { ExperimentType } from "@prisma/client";
import { useRouter } from "next/router";
import { MoreVertical, Plus } from "react-feather";
import {
  LuCircleCheckBig,
  LuCircleX,
  LuClock,
  LuPencil,
  LuSquareCheckBig,
  LuTrash,
} from "react-icons/lu";
import { DashboardLayout } from "../../components/DashboardLayout";
import { MonitorsSection } from "../../components/evaluations/MonitorsSection";
import type { TASK_TYPES } from "../../components/evaluations/wizard/hooks/evaluation-wizard-store/useEvaluationWizardStore";
import {
  formatEvaluationSummary,
  getFinishedAt,
} from "../../components/experiments/BatchEvaluationV2/BatchEvaluationSummary";
import { OverflownTextWithTooltip } from "../../components/OverflownText";
import { Link } from "../../components/ui/link";
import { Menu } from "../../components/ui/menu";
import { toaster } from "../../components/ui/toaster";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { TeamRoleGroup } from "../../server/api/permission";
import { api } from "../../utils/api";

export default function EvaluationsV2() {
  const { project, hasTeamPermission } = useOrganizationTeamProject();
  const router = useRouter();

  const monitors = api.monitors.getAllForProject.useQuery(
    {
      projectId: project?.id ?? "",
    },
    { enabled: !!project }
  );

  const experiments = api.experiments.getAllForEvaluationsList.useQuery(
    {
      projectId: project?.id ?? "",
    },
    { enabled: !!project }
  );

  const deleteExperimentMutation = api.experiments.deleteExperiment.useMutation(
    {
      onSuccess: () => {
        void experiments.refetch();
        void monitors.refetch();
        toaster.create({
          title: "Experiment deleted",
          type: "success",
          placement: "top-end",
          meta: {
            closable: true,
          },
        });
      },
      onError: () => {
        toaster.create({
          title: "Error deleting experiment",
          description:
            "Please try again. If the problem persists, contact support.",
          type: "error",
          placement: "top-end",
          meta: {
            closable: true,
          },
        });
      },
    }
  );

  const handleDeleteExperiment = (
    experimentId: string,
    experimentName: string
  ) => {
    if (
      confirm(
        `Are you sure you want to delete the evaluation "${experimentName}"? This will also delete the workflow, monitor, and prompts associated with it. Datasets will be kept.`
      )
    ) {
      deleteExperimentMutation.mutate({
        projectId: project?.id ?? "",
        experimentId,
      });
    }
  };

  if (!project) return null;

  const taskTypeToLabel: Record<keyof typeof TASK_TYPES, string> = {
    real_time: "Real-Time Evaluation",
    llm_app: "LLM App Evaluation",
    prompt_creation: "Prompt Creation",
    custom_evaluator: "Custom Evaluator",
    scan: "Scan for Vulnerabilities",
  };

  const experimentTypeToLabel: Record<ExperimentType, string> = {
    BATCH_EVALUATION_V2: "API Batch Evaluation",
    BATCH_EVALUATION: "Batch Evaluation",
    DSPY: "DSPy Optimization",
  };

  return (
    <DashboardLayout>
      <Container maxW={"calc(min(1440px, 100vw - 200px))"} padding={6}>
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
            </HStack>
          </HStack>

          {monitors.isLoading ? (
            <Box display="flex" justifyContent="center" py={8}>
              <Spinner />
            </Box>
          ) : monitors.isError ? (
            <Box>
              <Text color="red.500">Error loading evaluations</Text>
            </Box>
          ) : (
            <>
              <MonitorsSection title="Active Monitors" monitors={monitors} />

              <VStack align="start" gap={1}>
                <Heading as="h1">Evaluations</Heading>
                <Text color="gray.600">
                  View and analyze your evaluation results
                </Text>
              </VStack>

              <Card.Root>
                <Card.Body overflowX="auto">
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
                          <Table.ColumnHeader width="20%">
                            Evaluation
                          </Table.ColumnHeader>
                          <Table.ColumnHeader width="15%">
                            Type
                          </Table.ColumnHeader>
                          <Table.ColumnHeader width="10%">
                            Dataset
                          </Table.ColumnHeader>
                          <Table.ColumnHeader width="20%">
                            Primary Metric
                          </Table.ColumnHeader>
                          <Table.ColumnHeader width="10%">
                            Runs
                          </Table.ColumnHeader>
                          <Table.ColumnHeader width="10%">
                            Status
                          </Table.ColumnHeader>
                          <Table.ColumnHeader width="10%">
                            Last Updated
                          </Table.ColumnHeader>
                          <Table.ColumnHeader width="5%"></Table.ColumnHeader>
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
                                  if (experiment.wizardState) {
                                    void router.push({
                                      pathname: `/${project?.slug}/evaluations/wizard/${experiment.slug}`,
                                    });
                                  } else {
                                    void router.push({
                                      pathname: `/${project?.slug}/experiments/${experiment.slug}`,
                                    });
                                  }
                                }}
                                key={i}
                              >
                                <Table.Cell>
                                  <OverflownTextWithTooltip
                                    lineClamp={1}
                                    wordBreak="break-word"
                                  >
                                    {experiment.name ?? experiment.slug}
                                  </OverflownTextWithTooltip>
                                </Table.Cell>
                                <Table.Cell whiteSpace="nowrap">
                                  <Badge colorPalette="gray" variant="outline">
                                    {experiment.wizardState?.task
                                      ? taskTypeToLabel[
                                          experiment.wizardState.task
                                        ]
                                      : experimentTypeToLabel[experiment.type]}
                                  </Badge>
                                </Table.Cell>
                                <Table.Cell>
                                  <OverflownTextWithTooltip
                                    lineClamp={1}
                                    wordBreak="break-word"
                                  >
                                    {experiment.dataset?.name ?? "-"}
                                  </OverflownTextWithTooltip>
                                </Table.Cell>
                                <Table.Cell>
                                  {experiment.runsSummary.primaryMetric ? (
                                    <>
                                      <Text
                                        as="span"
                                        fontSize="xs"
                                        color="gray.600"
                                      >
                                        {
                                          experiment.runsSummary.primaryMetric
                                            .name
                                        }
                                        : &nbsp;
                                      </Text>
                                      <Text as="span" fontWeight="semibold">
                                        {formatEvaluationSummary(
                                          experiment.runsSummary.primaryMetric,
                                          true
                                        )}
                                      </Text>
                                    </>
                                  ) : (
                                    "-"
                                  )}
                                </Table.Cell>
                                <Table.Cell>
                                  {experiment.runsSummary.count || ""}
                                </Table.Cell>
                                <Table.Cell>
                                  {experiment.runsSummary.latestRun
                                    ?.timestamps && (
                                    <>
                                      {getFinishedAt(
                                        experiment.runsSummary.latestRun
                                          .timestamps,
                                        new Date().getTime()
                                      ) ? (
                                        <HStack color="green.500">
                                          <LuCircleCheckBig size={16} />
                                          Completed
                                        </HStack>
                                      ) : experiment.runsSummary.latestRun
                                          .timestamps.stopped_at ? (
                                        <HStack color="red.500">
                                          <LuCircleX size={16} />
                                          Stopped
                                        </HStack>
                                      ) : (
                                        <HStack color="blue.500">
                                          <LuClock size={16} />
                                          Running
                                        </HStack>
                                      )}
                                    </>
                                  )}
                                </Table.Cell>
                                <Table.Cell whiteSpace="nowrap">
                                  {new Date(
                                    experiment.updatedAt
                                  ).toLocaleString()}
                                </Table.Cell>
                                <Table.Cell>
                                  <Box
                                    width="full"
                                    height="full"
                                    display="flex"
                                    justifyContent="end"
                                  >
                                    <Menu.Root>
                                      <Menu.Trigger
                                        onClick={(e) => {
                                          e.stopPropagation();
                                        }}
                                      >
                                        <MoreVertical size={16} />
                                      </Menu.Trigger>
                                      <Menu.Content>
                                        <Menu.Item
                                          value="edit"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void router.push(
                                              `/${project?.slug}/evaluations/wizard/${experiment.slug}`
                                            );
                                          }}
                                        >
                                          <LuPencil size={16} />
                                          Edit
                                        </Menu.Item>
                                        <Menu.Item
                                          value="delete"
                                          color="red.500"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteExperiment(
                                              experiment.id,
                                              experiment.name ?? experiment.slug
                                            );
                                          }}
                                        >
                                          <LuTrash size={16} />
                                          Delete
                                        </Menu.Item>
                                      </Menu.Content>
                                    </Menu.Root>
                                  </Box>
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
