import {
  Badge,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  IconButton,
  SimpleGrid,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { TRPCClientErrorLike } from "@trpc/react-query";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { CopyIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { LangyContextTarget } from "~/features/langy/components/LangyContextTarget";
import {
  LuActivity,
  LuChevronDown,
  LuChevronUp,
  LuEllipsis,
  LuPause,
  LuPencil,
  LuPlay,
  LuTrash,
  LuTrendingUp,
} from "react-icons/lu";
import { useRouter } from "~/utils/compat/next-router";
import { Menu } from "../../components/ui/menu";
import { Tooltip } from "../../components/ui/tooltip";
import { useDrawer } from "../../hooks/useDrawer";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { AppRouter } from "../../server/api/root";
import { getEvaluatorDefinitions } from "../../server/evaluations/getEvaluator";
import { api } from "../../utils/api";
import { CustomGraph } from "../analytics/CustomGraph";
import { ConfirmDialog } from "../gateway/ConfirmDialog";
import { Link } from "../ui/link";
import { toaster } from "../ui/toaster";
import { CopyMonitorDialog } from "./CopyMonitorDialog";

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
    monitorId: string;
    monitorName: string;
  } | null>(null);
  const [monitorToDelete, setMonitorToDelete] = useState<{ id: string } | null>(
    null,
  );

  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const { openDrawer } = useDrawer();

  const experiments = api.experiments.getAllForEvaluationsList.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

  const experimentsSlugMap = useMemo(() => {
    return Object.fromEntries(
      experiments.data?.experiments?.map((experiment) => [
        experiment.id,
        experiment.slug,
      ]) ?? [],
    );
  }, [experiments.data]);

  const deleteMonitorMutation = api.monitors.delete.useMutation({
    onSuccess: () => {
      void monitors.refetch();
      void experiments.refetch();
      toaster.create({
        title: "Successfully deleted online evaluation",
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

  // A monitor can be paused (the overflow menu's Enable/Disable), and the old
  // header counted every one of them under the word "Active". Split the two so
  // the number matches the noun.
  const activeCount = useMemo(
    () => monitors.data?.filter((monitor) => monitor.enabled).length ?? 0,
    [monitors.data],
  );
  const pausedCount = (monitors.data?.length ?? 0) - activeCount;

  return (
    <Card.Root mb={8}>
      <Card.Body>
        <HStack justify="space-between" align="start" gap={4} mb={5}>
          <HStack gap={3} align="center">
            {/* An icon tile anchors the section the way the cards below it are
                anchored, and picks up the same teal the monitor graphs plot in
                (`colorSet: "tealTones"`) so the header and its content read as
                one block rather than a title floating above strangers. */}
            <Box
              display="grid"
              placeItems="center"
              flexShrink={0}
              width="36px"
              height="36px"
              borderRadius="md"
              background="teal.subtle"
              color="teal.fg"
            >
              <LuActivity size={18} />
            </Box>
            <VStack align="start" gap={0.5}>
              <HStack gap={2}>
                <Heading size="md">{title}</Heading>
                {/* The old badge read "{total} Active" while counting EVERY
                    monitor, paused ones included — it told you a number and
                    then mislabelled it. Count what the word says, and account
                    for the rest separately so a paused monitor is visible
                    instead of quietly inflating the "active" figure.

                    The green is a DOT, not a fill: a green-palette badge glows
                    against the dark ground, and a count is not an alert. The dot
                    carries the status, the badge stays neutral. */}
                <Badge colorPalette="gray" variant="subtle" gap={1.5}>
                  <Box
                    width="6px"
                    height="6px"
                    borderRadius="full"
                    flexShrink={0}
                    background={activeCount > 0 ? "green.solid" : "fg.subtle"}
                  />
                  {activeCount} active
                </Badge>
                {pausedCount > 0 && (
                  <Badge colorPalette="gray" variant="subtle" color="fg.muted">
                    {pausedCount} paused
                  </Badge>
                )}
              </HStack>
              <Text textStyle="sm" color="fg.muted">
                Checks that run on your traces as they arrive.
              </Text>
            </VStack>
          </HStack>
          <HStack gap={1} flexShrink={0}>
            <Link href={`/${project?.slug}/analytics/evaluations`}>
              <Button size="sm" variant="ghost" textDecoration="none">
                <LuTrendingUp /> View analytics
              </Button>
            </Link>
            <IconButton
              aria-label={isCollapsed ? "Expand section" : "Collapse section"}
              aria-expanded={!isCollapsed}
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
                  // Point Langy at an online evaluation: with the panel open,
                  // bringing the pointer near the card outlines it and hovering
                  // it offers "Absorb context". The card's own click is
                  // untouched; closed, this is the plain positioned Box it has
                  // always been.
                  <LangyContextTarget
                    key={monitor.id}
                    target={{
                      id: `evaluation:${monitor.id}`,
                      kind: "evaluation",
                      label: `evaluation: ${monitor.name}`,
                      ref: monitor.id,
                    }}
                  >
                    {/* `lg` matches CustomGraph's own card radius. Langy's ring
                        follows the element's OWN border-radius, and this
                        positioning wrapper had none — so the outline squared off
                        the rounded card underneath it. Visually a no-op
                        otherwise. */}
                    <Box position="relative" borderRadius="lg">
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
                              backgroundColor: "bg.panel",
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

                              // Monitors with experimentId are part of the old wizard flow
                              if (
                                monitor.experimentId &&
                                experimentsSlugMap[monitor.experimentId]
                              ) {
                                void router.push(
                                  `/${project.slug}/experiments/workbench/${
                                    experimentsSlugMap[monitor.experimentId]
                                  }`,
                                );
                              } else {
                                // Open the OnlineEvaluationDrawer for editing
                                openDrawer("onlineEvaluation", {
                                  monitorId: monitor.id,
                                });
                              }
                            }}
                          >
                            <LuPencil size={16} />
                            Edit
                          </Menu.Item>
                          <Menu.Item
                            value="copy"
                            onClick={() => {
                              setCopyDialogState({
                                open: true,
                                monitorId: monitor.id,
                                monitorName: monitor.name,
                              });
                            }}
                          >
                            <CopyIcon size={16} /> Replicate to another project
                          </Menu.Item>
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
                            color="red.fg"
                            onClick={() => {
                              if (!project) return;
                              setMonitorToDelete({ id: monitor.id });
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
                  </LangyContextTarget>
                );
              })}
            </SimpleGrid>
          </>
        )}
      </Card.Body>
      {copyDialogState && (
        <CopyMonitorDialog
          open={copyDialogState.open}
          onClose={() => setCopyDialogState(null)}
          monitorId={copyDialogState.monitorId}
          monitorName={copyDialogState.monitorName}
        />
      )}
      <ConfirmDialog
        open={!!monitorToDelete}
        onOpenChange={(isOpen) => {
          if (!isOpen) setMonitorToDelete(null);
        }}
        title="Delete monitor"
        message="Are you sure you want to delete this monitor?"
        confirmLabel="Delete"
        tone="danger"
        loading={deleteMonitorMutation.isLoading}
        onConfirm={() => {
          if (!project || !monitorToDelete) return;
          deleteMonitorMutation.mutate(
            { id: monitorToDelete.id, projectId: project.id },
            { onSettled: () => setMonitorToDelete(null) },
          );
        }}
      />
    </Card.Root>
  );
};
