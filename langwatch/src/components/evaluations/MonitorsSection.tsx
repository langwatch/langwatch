import {
  Badge,
  Box,
  Card,
  Heading,
  HStack,
  IconButton,
  SimpleGrid,
  Text,
} from "@chakra-ui/react";
import type { TRPCClientErrorLike } from "@trpc/react-query";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { useRouter } from "next/router";
import { CopyIcon } from "lucide-react";
import { useMemo, useState } from "react";
import {
  LuChevronDown,
  LuChevronUp,
  LuEllipsis,
  LuPause,
  LuPencil,
  LuPlay,
  LuTrash,
} from "react-icons/lu";
import { Menu } from "../../components/ui/menu";
import { Tooltip } from "../../components/ui/tooltip";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { AppRouter } from "../../server/api/root";
import { getEvaluatorDefinitions } from "../../server/evaluations/getEvaluator";
import { api } from "../../utils/api";
import { CustomGraph } from "../analytics/CustomGraph";
import { CopyEvaluationDialog } from "./CopyEvaluationDialog";
import { Link } from "../ui/link";
import { toaster } from "../ui/toaster";

type MonitorsSectionProps = {
  title: string;
  monitors: UseTRPCQueryResult<
    inferRouterOutputs<AppRouter>["monitors"]["getAllForProject"],
    TRPCClientErrorLike<AppRouter>
  >;
};

export const MonitorsSection = ({ title, monitors }: MonitorsSectionProps) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [copyDialogState, setCopyDialogState] = useState<{
    open: boolean;
    experimentId: string;
    evaluationName: string;
  } | null>(null);

  const { project, hasPermission } = useOrganizationTeamProject();
  const router = useRouter();

  const experiments = api.experiments.getAllForEvaluationsList.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

  const experimentsSlugMap = useMemo(() => {
    return Object.fromEntries(
      experiments.data?.map((experiment) => [experiment.id, experiment.slug]) ??
        [],
    );
  }, [experiments.data]);

  const deleteMonitorMutation = api.monitors.delete.useMutation({
    onSuccess: () => {
      void monitors.refetch();
      void experiments.refetch();
      toaster.create({
        title: "Successfully deleted monitor",
        type: "success",
        meta: {
          closable: true,
        },
      });
    },
    onError: () => {
      toaster.create({
        title: "Error deleting monitor",
        description: "Please try again",
        type: "error",
        meta: {
          closable: true,
        },
      });
    },
  });

  const toggleMonitorMutation = api.monitors.toggle.useMutation();

  return (
    <Card.Root mb={8}>
      <Card.Body>
        <HStack justify="space-between" mb={4}>
          <HStack gap={2}>
            <Heading size="md">{title}</Heading>
            <Badge variant="outline" px={2} py={1}>
              {monitors.data?.length} Active
            </Badge>
          </HStack>
          <IconButton
            aria-label={isCollapsed ? "Expand section" : "Collapse section"}
            variant="ghost"
            size="sm"
            onClick={() => setIsCollapsed(!isCollapsed)}
          >
            {isCollapsed ? (
              <LuChevronDown size={16} />
            ) : (
              <LuChevronUp size={16} />
            )}
          </IconButton>
        </HStack>

        {!isCollapsed && (
          <>
            <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap={4}>
              {monitors.data?.map((monitor) => {
                const evaluatorDefinition = getEvaluatorDefinitions(
                  monitor.checkType,
                );
                // TODO: handle custom evaluators

                return (
                  <Box key={monitor.id} position="relative">
                    <Menu.Root>
                      <Menu.Trigger
                        asChild
                        position="absolute"
                        top={4}
                        right={4}
                        zIndex={2}
                      >
                        <IconButton
                          variant="ghost"
                          size="sm"
                          aria-label="More options"
                          _hover={{
                            backgroundColor: "white",
                          }}
                        >
                          <LuEllipsis size={16} />
                        </IconButton>
                      </Menu.Trigger>
                      <Menu.Content>
                        <Menu.Item
                          value="edit"
                          onClick={() => {
                            if (!project) return;

                            console.log(
                              "experimentsSlugMap",
                              experimentsSlugMap,
                            );
                            console.log("monitor", monitor);

                            if (
                              monitor.experimentId &&
                              experimentsSlugMap[monitor.experimentId]
                            ) {
                              void router.push(
                                `/${project.slug}/evaluations/wizard/${
                                  experimentsSlugMap[monitor.experimentId]
                                }`,
                              );
                            } else {
                              void router.push(
                                `/${project.slug}/evaluations/${monitor.id}/edit`,
                              );
                            }
                          }}
                        >
                          <LuPencil size={16} />
                          Edit
                        </Menu.Item>
                        {monitor.experimentId && (
                          <Tooltip
                            content={
                              !hasPermission("evaluations:manage")
                                ? "You need evaluations:manage permission to replicate evaluations"
                                : undefined
                            }
                            disabled={hasPermission("evaluations:manage")}
                            positioning={{ placement: "right" }}
                            showArrow
                          >
                            <Menu.Item
                              value="copy"
                              onClick={() => {
                                if (!project || !monitor.experimentId) return;

                                if (hasPermission("evaluations:manage")) {
                                  const experiment = experiments.data?.find(
                                    (e) => e.id === monitor.experimentId,
                                  );
                                  if (experiment) {
                                    setCopyDialogState({
                                      open: true,
                                      experimentId: experiment.id,
                                      evaluationName:
                                        experiment.name ?? experiment.slug,
                                    });
                                  }
                                }
                              }}
                              disabled={!hasPermission("evaluations:manage")}
                            >
                              <CopyIcon size={16} /> Replicate to another
                              project
                            </Menu.Item>
                          </Tooltip>
                        )}
                        <Menu.Item
                          value="toggle"
                          onClick={() => {
                            if (!project) return;

                            void toggleMonitorMutation.mutate(
                              {
                                id: monitor.id,
                                projectId: project.id,
                                enabled: !monitor.enabled,
                              },
                              {
                                onSuccess: () => {
                                  void monitors.refetch();
                                  toaster.create({
                                    title: `Monitor ${
                                      monitor.enabled ? "disabled" : "enabled"
                                    }`,
                                    type: "info",
                                    meta: { closable: true },
                                  });
                                },
                              },
                            );
                          }}
                        >
                          {monitor.enabled ? (
                            <>
                              <LuPause size={16} />
                              Disable
                            </>
                          ) : (
                            <>
                              <LuPlay size={16} />
                              Enable
                            </>
                          )}
                        </Menu.Item>
                        <Menu.Item
                          value="delete"
                          color="red.500"
                          onClick={() => {
                            if (!project) return;

                            if (
                              !confirm(
                                "Are you sure you want to delete this monitor?",
                              )
                            )
                              return;

                            void deleteMonitorMutation.mutate({
                              id: monitor.id,
                              projectId: project.id,
                            });
                          }}
                        >
                          <LuTrash size={16} />
                          Delete
                        </Menu.Item>
                      </Menu.Content>
                    </Menu.Root>
                    <CustomGraph
                      input={{
                        graphId: monitor.id,
                        graphType: "monitor_graph",
                        series: [
                          {
                            aggregation: "avg",
                            colorSet: "tealTones",
                            key: monitor.id,
                            metric: evaluatorDefinition?.isGuardrail
                              ? "evaluations.evaluation_pass_rate"
                              : "evaluations.evaluation_score",
                            name: monitor.name,
                          },
                        ],
                        includePrevious: false,
                        timeScale: 1,
                        height: 140,
                        monitorGraph: {
                          disabled: !monitor.enabled,
                          isGuardrail: monitor.executionMode === "AS_GUARDRAIL",
                        },
                      }}
                    />
                  </Box>
                );
              })}
            </SimpleGrid>
            {monitors.data?.length === 0 && (
              <Text color="gray.600">
                No real-time monitors or guardrails set up yet.
                {project && hasPermission("evaluations:manage") && (
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
              </Text>
            )}
          </>
        )}
      </Card.Body>
      {copyDialogState && (
        <CopyEvaluationDialog
          open={copyDialogState.open}
          onClose={() => setCopyDialogState(null)}
          experimentId={copyDialogState.experimentId}
          evaluationName={copyDialogState.evaluationName}
        />
      )}
    </Card.Root>
  );
};
