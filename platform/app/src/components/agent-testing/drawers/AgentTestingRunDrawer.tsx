/**
 * The Agent Testing run detail drawer: the same run drawer the classic pages
 * use, wider, with the judge results beside the conversation when the screen
 * gives enough room and stacked under it when it does not.
 *
 * It can open before the run has an id: a one-off run opens the drawer the
 * moment it is queued, the batch is watched until the run appears, and the
 * conversation then streams in live.
 *
 * @see specs/features/agent-testing/side-by-side-run-drawer.feature
 * @see specs/features/agent-testing/live-one-off-run.feature
 * @see specs/scenarios/scenario-version-on-runs.feature
 */

import {
  Accordion,
  Box,
  Button,
  Grid,
  Heading,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { History, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CopyButton } from "~/components/CopyButton";
import { RunScenarioModal } from "~/components/scenarios/RunScenarioModal";
import { ScenarioFormDrawer } from "~/components/scenarios/ScenarioFormDrawer";
import { formatCost, formatLatency } from "~/components/shared/formatters";
import { CopyIdChip } from "~/components/simulations/CopyIdChip";
import { RunCriteriaChip } from "~/components/simulations/RunCriteriaChip";
import { RunDetailSection } from "~/components/simulations/RunDetailSection";
import { ScenarioMessageRenderer } from "~/components/simulations/ScenarioMessageRenderer";
import { ScenarioRunActions } from "~/components/simulations/ScenarioRunActions";
import {
  formatResultsForCopy,
  ParameterRow,
  SECRET_VALUE_MASK,
  useScenarioRunDetail,
} from "~/components/simulations/ScenarioRunDetailDrawer";
import { ScenarioRunStatusIcon } from "~/components/simulations/ScenarioRunStatusIcon";
import { hasNoResults } from "~/components/simulations/scenario-run-status.utils";
import { SimulationConsole } from "~/components/simulations/simulation-console/SimulationConsole";
import {
  isCancellableStatus,
  useCancelScenarioRun,
} from "~/components/suites/useCancelScenarioRun";
import {
  isTerminalStatus,
  type ScenarioRunStatus,
} from "~/server/scenarios/scenario-event.enums";
import { Drawer } from "~/components/ui/drawer";
import { Tooltip } from "~/components/ui/tooltip";
import { HandledErrorAlert } from "~/features/errors";
import { Chip } from "~/features/traces-v2/components/TraceDrawer/Chip";
import { ConversationExpandContext } from "~/features/traces-v2/components/TraceDrawer/conversationView/expandContext";
import { useCan } from "~/hooks/useCan";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useTargetNameMap } from "~/hooks/useTargetNameMap";
import { api } from "~/utils/api";
import { CaseVersionChip } from "../shared/CaseVersionChip";

/** How wide the window must be before the results sit beside the conversation. */
export const SIDE_BY_SIDE_MIN_WIDTH = 1100;

/** What the console title bar reads in Agent Testing. */
export const AGENT_TESTING_CONSOLE_FILE_NAME = "test-results.log";

/** True when the window gives the side-by-side layout enough room. */
export function useSideBySideLayout(): boolean {
  const [sideBySide, setSideBySide] = useState(
    () =>
      typeof window !== "undefined" &&
      window.innerWidth >= SIDE_BY_SIDE_MIN_WIDTH,
  );

  useEffect(() => {
    const onResize = () =>
      setSideBySide(window.innerWidth >= SIDE_BY_SIDE_MIN_WIDTH);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return sideBySide;
}

/** True once the judge has said something about this run. */
function hasCriteria(scenarioState: {
  results?: {
    metCriteria?: string[] | null;
    unmetCriteria?: string[] | null;
  } | null;
}): boolean {
  const results = scenarioState.results;
  if (!results) return false;
  return (
    (results.metCriteria?.length ?? 0) + (results.unmetCriteria?.length ?? 0) > 0
  );
}

/**
 * Reads the stored run once more the moment the run settles.
 *
 * The event that carries the terminal status can beat the write of the
 * results, and a settled run stops polling, so without this the drawer keeps
 * the state it held while the run was still going: no criteria, and no
 * success rate.
 */
function useRereadOnSettled({
  scenarioRunId,
  scenarioState,
  open,
}: {
  scenarioRunId: string | undefined;
  scenarioState: { status: ScenarioRunStatus; results?: unknown } | undefined;
  open: boolean;
}): void {
  const utils = api.useUtils();
  const utilsRef = useRef(utils);
  utilsRef.current = utils;

  const settledWithoutResults =
    !!scenarioState &&
    isTerminalStatus(scenarioState.status) &&
    !hasCriteria(scenarioState as Parameters<typeof hasCriteria>[0]);

  useEffect(() => {
    if (!open || !scenarioRunId || !settledWithoutResults) return;
    const timer = setTimeout(() => {
      void utilsRef.current.scenarios.getRunState.invalidate({ scenarioRunId });
    }, 500);
    return () => clearTimeout(timer);
  }, [open, scenarioRunId, settledWithoutResults]);
}

/**
 * The run of the batch, once it exists. A drawer opened at queue time knows
 * only the batch; the batch is read again until the run shows up.
 */
function useResolvedScenarioRunId({ open }: { open: boolean }): {
  scenarioRunId: string | undefined;
  scenarioId: string | undefined;
} {
  const params = useDrawerParams();
  const { project } = useOrganizationTeamProject();
  const needsResolution =
    !params.scenarioRunId && !!params.batchRunId && !!params.scenarioSetId;

  const { data } = api.scenarios.getBatchRunData.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId: params.scenarioSetId ?? "",
      batchRunId: params.batchRunId ?? "",
    },
    {
      enabled: open && needsResolution && !!project?.id,
      refetchInterval: (query) => {
        const result = query.state.data;
        const runs = result && "runs" in result ? result.runs : [];
        return runs.length > 0 ? false : 1000;
      },
    },
  );

  const runs = data && "runs" in data ? data.runs : [];
  const resolved =
    runs.find((run) => run.scenarioId === params.scenarioId) ?? runs[0];

  return {
    scenarioRunId: params.scenarioRunId ?? resolved?.scenarioRunId,
    scenarioId: params.scenarioId ?? resolved?.scenarioId,
  };
}

export function AgentTestingRunDrawer({ open }: { open?: boolean }) {
  const { closeDrawer } = useDrawer();
  const params = useDrawerParams();
  const { project } = useOrganizationTeamProject();
  const { can } = useCan();
  const utils = api.useUtils();

  const { scenarioRunId, scenarioId: knownScenarioId } =
    useResolvedScenarioRunId({ open: !!open });

  const detail = useScenarioRunDetail({ scenarioRunId, open: !!open });
  const { scenarioState } = detail;

  useRereadOnSettled({ scenarioRunId, scenarioState, open: !!open });

  const sideBySide = useSideBySideLayout();

  const scenarioVersion =
    scenarioState?.metadata?.langwatch?.scenarioVersion ?? null;

  const openVersionHistory = useCallback(() => {
    const caseId = detail.scenarioId ?? knownScenarioId;
    if (!caseId) return;
    detail.openDrawer("scenarioVersionHistory", {
      urlParams: {
        scenarioId: caseId,
        ...(scenarioVersion != null
          ? { markVersion: String(scenarioVersion) }
          : {}),
      },
    });
  }, [detail, knownScenarioId, scenarioVersion]);

  const { cancelJob } = useCancelScenarioRun({
    onCancelJobSuccess: () => void utils.scenarios.getRunState.invalidate(),
  });
  const canStop =
    can("scenarios:manage") &&
    !!params.scenarioSetId &&
    !!scenarioState &&
    isCancellableStatus(scenarioState.status);
  const handleStop = useCallback(() => {
    if (!project?.id || !scenarioState || !scenarioRunId) return;
    cancelJob({
      projectId: project.id,
      scenarioSetId: params.scenarioSetId ?? "",
      batchRunId: params.batchRunId ?? scenarioState.batchRunId,
      scenarioRunId,
      scenarioId: scenarioState.scenarioId,
    });
  }, [project?.id, scenarioState, scenarioRunId, params, cancelJob]);

  return (
    <>
      <Drawer.Root
        open={!!open}
        onOpenChange={() => closeDrawer()}
        placement="end"
        size="lg"
      >
        <Drawer.Content
          bg="transparent"
          paddingX={0}
          maxWidth="1100px"
          overflow="hidden"
          borderRadius="lg"
          data-testid="agent-testing-run-drawer"
        >
          {!scenarioState && (
            <QueuedBody
              error={detail.runStateError}
              scenarioId={knownScenarioId}
            />
          )}
          {scenarioState && (
            <Drawer.Body
              paddingY={0}
              paddingX={0}
              display="flex"
              flexDirection="column"
              width="full"
              height="full"
              overflow="hidden"
              bg={{ base: "bg.surface", _dark: "bg.panel" }}
            >
              <DrawerHeaderBand
                detail={detail}
                scenarioVersion={scenarioVersion}
                onOpenVersionHistory={openVersionHistory}
                canStop={canStop}
                onStop={handleStop}
              />
              <DrawerContent detail={detail} sideBySide={sideBySide} />
            </Drawer.Body>
          )}
        </Drawer.Content>
      </Drawer.Root>

      <RunScenarioModal
        open={detail.runModalOpen}
        onClose={() => detail.setRunModalOpen(false)}
        onRun={detail.handleRunAgain}
        initialTarget={detail.persistedTarget}
        isLoading={detail.isRunning}
      />

      <ScenarioFormDrawer
        open={detail.scenarioEditorOpen}
        onClose={() => detail.setScenarioEditorOpen(false)}
        scenarioId={detail.scenarioId ?? knownScenarioId}
        variant="agent-testing"
      />
    </>
  );
}

/** What the drawer reads while the run has no state yet: queued, or a failure. */
function QueuedBody({
  error,
  scenarioId,
}: {
  error: unknown;
  scenarioId: string | undefined;
}) {
  const { project } = useOrganizationTeamProject();
  const params = useDrawerParams();
  const targetNameMap = useTargetNameMap();

  const { data: scenario } = api.scenarios.getByIdIncludingArchived.useQuery(
    { projectId: project?.id ?? "", id: scenarioId ?? "" },
    { enabled: !!project?.id && !!scenarioId },
  );

  const targetName = params.targetId
    ? (targetNameMap.get(params.targetId) ?? null)
    : null;

  const isNotFound =
    !!error &&
    (error as { data?: { code?: string } }).data?.code === "NOT_FOUND";
  const hardError = error && !isNotFound;

  return (
    <Drawer.Body bg={{ base: "bg.surface", _dark: "bg.panel" }}>
      <VStack gap={3} align="start" w="100%" pt={4}>
        <Drawer.CloseTrigger />
        {hardError ? (
          <Box width="100%">
            <HandledErrorAlert
              error={error}
              fallbackTitle="Failed to load run"
            />
          </Box>
        ) : (
          <VStack gap={2} align="start" data-testid="wide-drawer-queued">
            <Heading size="md">{scenario?.name ?? "Run"}</Heading>
            {targetName && (
              <Text color="fg.muted" fontSize="sm">
                against {targetName}
              </Text>
            )}
            <HStack gap={2} color="fg.muted">
              <Spinner size="xs" />
              <Text fontSize="sm">Queued</Text>
            </HStack>
          </VStack>
        )}
      </VStack>
    </Drawer.Body>
  );
}

/** The fixed band at the top: status, title, version, actions, chip strip. */
function DrawerHeaderBand({
  detail,
  scenarioVersion,
  onOpenVersionHistory,
  canStop,
  onStop,
}: {
  detail: ReturnType<typeof useScenarioRunDetail>;
  scenarioVersion: number | null;
  onOpenVersionHistory: () => void;
  canStop: boolean;
  onStop: () => void;
}) {
  const { scenarioState, scenarioData } = detail;
  if (!scenarioState) return null;

  return (
    <VStack
      align="stretch"
      w="100%"
      gap={2}
      paddingX={4}
      paddingTop={3}
      paddingBottom={3}
      background="bg.panel/70"
      backdropFilter="blur(20px) saturate(150%)"
      borderTopRadius="lg"
      borderBottomWidth="1px"
      borderColor="border"
      flexShrink={0}
    >
      <HStack
        w="100%"
        justify="space-between"
        gap={2.5}
        minWidth={0}
        paddingEnd={8}
      >
        <HStack gap={3} flex={1} minWidth={0}>
          <ScenarioRunStatusIcon status={scenarioState.status} />
          <Heading size="md" truncate title={detail.displayTitle}>
            {detail.displayTitle}
          </Heading>
          {scenarioVersion != null && (
            <Box
              as="button"
              cursor="pointer"
              onClick={onOpenVersionHistory}
              aria-label={`Open the history of this test case at version ${scenarioVersion}`}
              data-testid="run-drawer-version"
            >
              <CaseVersionChip version={scenarioVersion} />
            </Box>
          )}
        </HStack>
        <HStack gap={1} flexShrink={0}>
          {scenarioData && (
            <Tooltip
              content="Version history"
              positioning={{ placement: "bottom" }}
            >
              <Button
                size="xs"
                variant="ghost"
                aria-label="Version history"
                onClick={onOpenVersionHistory}
                data-testid="run-drawer-history"
              >
                <History size={14} />
              </Button>
            </Tooltip>
          )}
          <ScenarioRunActions
            scenario={scenarioData}
            isRunning={detail.isRunning}
            onRunAgain={detail.handleRunAgainClick}
            onEditScenario={() => detail.setScenarioEditorOpen(true)}
            onOpenThread={
              detail.firstTraceId && !hasNoResults(scenarioState.status)
                ? () =>
                    detail.openDrawer("traceV2Details", {
                      traceId: detail.firstTraceId!,
                      mode: "conversation",
                    })
                : null
            }
            onOpenInTraces={
              detail.firstTraceId && !hasNoResults(scenarioState.status)
                ? detail.handleOpenInTraces
                : null
            }
            dejaViewHref={detail.dejaView.href ?? null}
          />
          {canStop && (
            <Button
              size="xs"
              variant="outline"
              onClick={onStop}
              data-testid="run-drawer-stop"
            >
              <Square size={12} />
              Stop
            </Button>
          )}
          <Drawer.CloseTrigger />
        </HStack>
      </HStack>

      <HStack w="100%" gap={1.5} flexWrap="wrap">
        {scenarioState.results && !hasNoResults(scenarioState.status) && (
          <RunCriteriaChip
            metCriteria={scenarioState.results.metCriteria ?? []}
            unmetCriteria={scenarioState.results.unmetCriteria ?? []}
          />
        )}
        {scenarioState.durationInMs > 0 && (
          <Chip
            label="Duration"
            value={formatLatency(scenarioState.durationInMs)}
          />
        )}
        {scenarioState.totalCost != null && (
          <Chip label="Cost" value={formatCost(scenarioState.totalCost)} />
        )}
        {detail.timeAgo && <Chip label="Ran" value={detail.timeAgo} />}
        {scenarioData?.archivedAt && <Chip value="Archived" tone="yellow" />}
        {detail.copyableIds?.map((id) => (
          <CopyIdChip key={id.label} label={id.label} value={id.value} />
        ))}
      </HStack>
    </VStack>
  );
}

/** The two layouts: conversation beside the results, or stacked as v1 reads. */
function DrawerContent({
  detail,
  sideBySide,
}: {
  detail: ReturnType<typeof useScenarioRunDetail>;
  sideBySide: boolean;
}) {
  if (sideBySide) {
    return (
      <Grid
        templateColumns="minmax(0, 1fr) minmax(0, 460px)"
        flex={1}
        minHeight={0}
        data-testid="wide-drawer-side-by-side"
      >
        <Box
          style={{ overflowY: "auto" }}
          borderRightWidth="1px"
          borderColor="border"
          data-testid="wide-drawer-conversation"
        >
          <Accordion.Root
            multiple
            defaultValue={["conversation", "no-response"]}
          >
            <ConversationSection detail={detail} />
          </Accordion.Root>
        </Box>
        <Box style={{ overflowY: "auto" }} data-testid="wide-drawer-results">
          <Accordion.Root multiple defaultValue={["results", "parameters"]}>
            <ResultsSection detail={detail} isFirst />
            <ParametersSection detail={detail} />
          </Accordion.Root>
        </Box>
      </Grid>
    );
  }

  return (
    <Box
      flex={1}
      minHeight={0}
      overflowY="auto"
      data-testid="wide-drawer-stacked"
    >
      <Accordion.Root
        multiple
        defaultValue={["conversation", "no-response", "results", "parameters"]}
      >
        <ConversationSection detail={detail} />
        <ResultsSection
          detail={detail}
          isFirst={!detail.hasConversation && !detail.showNoResponse}
        />
        <ParametersSection detail={detail} />
      </Accordion.Root>
    </Box>
  );
}

function ConversationSection({
  detail,
}: {
  detail: ReturnType<typeof useScenarioRunDetail>;
}) {
  const { scenarioState, project } = detail;
  if (!scenarioState) return null;

  if (detail.showNoResponse) {
    return (
      <RunDetailSection value="no-response" title="Conversation" isFirst>
        <VStack
          align="center"
          justify="center"
          gap={2}
          paddingY={8}
          color="fg.muted"
          data-testid="scenario-no-response"
        >
          <Text fontSize="sm" fontWeight="medium" color="fg">
            No response
          </Text>
          <Text fontSize="xs" textAlign="center" maxWidth="320px">
            The agent under test didn&apos;t return any messages for this run.
          </Text>
        </VStack>
      </RunDetailSection>
    );
  }

  if (!detail.hasConversation) {
    return (
      <RunDetailSection value="conversation" title="Conversation" isFirst>
        <HStack gap={2} color="fg.muted" paddingY={6} justify="center">
          <Spinner size="xs" />
          <Text fontSize="sm">Waiting for the first message</Text>
        </HStack>
      </RunDetailSection>
    );
  }

  return (
    <RunDetailSection
      value="conversation"
      title="Conversation"
      count={detail.conversationCount}
      isFirst
    >
      <ConversationExpandContext.Provider
        value={{ isExpandable: true, shouldExpandAll: false }}
      >
        <ScenarioMessageRenderer
          messages={scenarioState.messages ?? []}
          streamingMessages={detail.streamingMessages}
          variant="drawer"
          projectId={project?.id ?? ""}
        />
      </ConversationExpandContext.Provider>
    </RunDetailSection>
  );
}

function ResultsSection({
  detail,
  isFirst,
}: {
  detail: ReturnType<typeof useScenarioRunDetail>;
  isFirst: boolean;
}) {
  const { scenarioState } = detail;
  if (!scenarioState) return null;

  // A run that has not settled has no verdict, whatever its stored results
  // hold. Drawing the console then reads "0/0", which says the judge failed
  // every criterion rather than that it has not spoken yet.
  const judgePending =
    !isTerminalStatus(scenarioState.status) && !hasCriteria(scenarioState);

  return (
    <RunDetailSection
      value="results"
      title="Results"
      count={detail.criteria?.total}
      isFirst={isFirst}
    >
      {judgePending ? (
        <VStack
          align="center"
          gap={2}
          paddingY={8}
          color="fg.muted"
          data-testid="judge-pending"
        >
          <Spinner size="xs" />
          <Text fontSize="sm">The judge has not run yet.</Text>
        </VStack>
      ) : (
        <Box
          borderRadius="xl"
          overflow="hidden"
          borderWidth="1px"
          borderColor="border.muted"
          boxShadow="sm"
        >
          <SimulationConsole
            fileName={AGENT_TESTING_CONSOLE_FILE_NAME}
            results={scenarioState.results}
            scenarioName={scenarioState.name ?? undefined}
            status={scenarioState.status}
            durationInMs={scenarioState.durationInMs}
            titleBarActions={
              scenarioState.results ? (
                <CopyButton
                  value={formatResultsForCopy(scenarioState.results)}
                  label="Results"
                  size="2xs"
                  color="gray.500"
                  _hover={{ color: "gray.200", bg: "gray.800" }}
                />
              ) : undefined
            }
          />
        </Box>
      )}
    </RunDetailSection>
  );
}

function ParametersSection({
  detail,
}: {
  detail: ReturnType<typeof useScenarioRunDetail>;
}) {
  const total = detail.parameters.length + detail.secretParameterNames.length;
  if (total === 0) return null;

  return (
    <RunDetailSection value="parameters" title="Parameters" count={total}>
      <VStack align="stretch" gap={1.5} data-testid="run-parameters">
        {detail.parameters.map(([name, value]) => (
          <ParameterRow key={name} name={name} value={String(value)} />
        ))}
        {detail.secretParameterNames.map((name) => (
          <ParameterRow
            key={name}
            name={name}
            value={SECRET_VALUE_MASK}
            muted
          />
        ))}
      </VStack>
    </RunDetailSection>
  );
}
