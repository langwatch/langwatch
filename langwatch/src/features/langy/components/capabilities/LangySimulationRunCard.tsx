/**
 * Live simulation-run card (the `simulationRun` card kind —
 * `simulation-run get`).
 *
 * The tool envelope only carries the STRUCTURED reference — the
 * `simulationRun` card schema requires `scenarioRunId`, so by the time this
 * card mounts the id is validated data, never something regexed out of prose.
 * The card renders the run's CURRENT state through the same query + polling
 * policy the simulations drawer uses (`getRunState` +
 * `getRunStatePollInterval` + the SSE update listener). A running simulation
 * visibly progresses in the chat; a renamed scenario shows its current name.
 *
 * A run the platform can't answer for (deleted, stale id) falls back to the
 * snapshot rendering (`LangyEvalRunCard`), so the card never renders an
 * error for prose the agent already explained.
 *
 * Spec: specs/langy/langy-live-scenario-cards.feature
 */
import { Badge, Box, HStack, Spinner, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { MessagePreview } from "~/components/suites/MessagePreview";
import { getRunStatePollInterval } from "~/components/simulations/run-state-polling";
import { SCENARIO_RUN_STATUS_CONFIG } from "~/components/simulations/scenario-run-status-config";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useSimulationStreamingState } from "~/hooks/useSimulationStreamingState";
import { useSimulationUpdateListener } from "~/hooks/useSimulationUpdateListener";
import type { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import type { StreamingMessage } from "~/hooks/useSimulationStreamingState";
import { api } from "~/utils/api";
import { extractPlatformUrl } from "~/utils/platformHref";
import type {
  CapabilityCardInput,
  CapabilityDescriptor,
} from "./capabilityRegistry";
import { LangyCapabilityCard } from "./LangyCapabilityCard";
import { LangyEvalRunCard } from "./LangyEvalRunCard";

export function LangySimulationRunCard(props: CapabilityCardInput) {
  // The `simulationRun` schema requires `scenarioRunId`, so a validated
  // payload always carries it — this read is the typed contract, not a scan.
  const runId =
    props.output && typeof props.output === "object"
      ? (props.output as { scenarioRunId?: unknown }).scenarioRunId
      : undefined;

  if (typeof runId !== "string" || !runId) {
    return <LangyEvalRunCard {...props} />;
  }
  return <LiveSimulationRunCard {...props} runId={runId} />;
}

/** Terminal per the drawer's own polling policy — the single source of "done". */
function statusIsTerminal(status?: ScenarioRunStatus): boolean {
  return (
    status !== undefined &&
    getRunStatePollInterval({ status, sseConnected: false }) === false
  );
}

function LiveSimulationRunCard({
  runId,
  ...props
}: CapabilityCardInput & { runId: string }) {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();

  const { streamingMessages, handleStreamingEvent, clearCompleted } =
    useSimulationStreamingState(runId);

  // A terminal run never changes; don't hold an SSE subscription per settled
  // card in a long conversation. SEEDED from the envelope's own status — the
  // typed payload already says "SUCCESS", so a settled card never opens a
  // subscription even for its first render. An unknown/absent status (a run
  // surfaced mid-flight) stays subscribed so it streams from the first frame;
  // the live query below flips the flag once the platform reports terminal.
  const [isTerminal, setIsTerminal] = useState(() =>
    statusIsTerminal(
      typeof (props.output as { status?: unknown }).status === "string"
        ? ((props.output as { status: string }).status as ScenarioRunStatus)
        : undefined,
    ),
  );

  const { data, error } = api.scenarios.getRunState.useQuery(
    { projectId: project?.id ?? "", scenarioRunId: runId },
    {
      enabled: !!project?.id,
      // An unknown run is a fallback, never a retry storm.
      retry: false,
      // Finished runs never change — stop polling entirely. Live runs poll
      // fast only while the event stream is down (the drawer's exact policy).
      refetchInterval: (queryData) =>
        getRunStatePollInterval({ status: queryData?.status, sseConnected }),
    },
  );

  const { isConnected: sseConnected } = useSimulationUpdateListener({
    projectId: project?.id ?? "",
    // `!error`: a run the platform can't answer for renders the fallback —
    // isTerminal never flips for it (only a terminal STATUS does), so without
    // this the dead card would hold its subscription open indefinitely.
    enabled: !!project?.id && !isTerminal && !error,
    debounceMs: 300,
    filter: { scenarioRunId: runId },
    onStreamingEvent: handleStreamingEvent,
  });

  const status = data?.status;
  useEffect(() => {
    if (statusIsTerminal(status)) setIsTerminal(true);
  }, [status]);

  // Drop optimistic streamed messages once the server state includes them.
  useEffect(() => {
    if (data?.messages) {
      clearCompleted(
        data.messages
          .map((m: { id?: string }) => m.id)
          .filter((id): id is string => !!id),
      );
    }
  }, [data?.messages, clearCompleted]);

  // The platform can't answer for this run (deleted, other project, stale
  // id): keep the chat useful with the snapshot the envelope carried.
  if (error) return <LangyEvalRunCard {...props} />;

  return (
    <LangySimulationRunReceipt
      overline={props.descriptor.overline}
      surface={props.descriptor.surface}
      projectSlug={props.projectSlug ?? null}
      resourceId={runId}
      platformUrl={extractPlatformUrl(props.output)}
      title={data ? (data.name ?? data.scenarioId) : ""}
      status={data?.status}
      messages={data?.messages}
      streamingMessages={streamingMessages}
      onOpen={() =>
        openDrawer("scenarioRunDetail", {
          urlParams: { scenarioRunId: runId },
        })
      }
    />
  );
}

/**
 * The receipt itself, pure of data fetching — the panel's own card language,
 * not the simulations grid's. A surfaced run is a READ receipt
 * (specs/langy/langy-card-taxonomy.feature): hairline shell, quiet overline,
 * and the outcome spent ONCE, as a small badge — never as a status-tinted
 * surface. The grid card's green belongs on the simulations page, where 30
 * cards are scanned by outcome. Exported so the developer card gallery can
 * render it from fixtures (the container above fetches live state by id,
 * which a gallery fixture id could never satisfy).
 */
export function LangySimulationRunReceipt({
  overline,
  surface,
  projectSlug,
  resourceId,
  platformUrl,
  title,
  status,
  messages,
  streamingMessages,
  onOpen,
}: {
  overline: string;
  surface: CapabilityDescriptor["surface"];
  projectSlug: string | null;
  resourceId: string;
  platformUrl: string | null;
  title: string;
  /** Undefined while the live state is still loading — renders a spinner. */
  status?: ScenarioRunStatus;
  messages?: ScenarioRunData["messages"];
  streamingMessages?: StreamingMessage[];
  onOpen: () => void;
}) {
  const statusConfig = status !== undefined ? SCENARIO_RUN_STATUS_CONFIG[status] : null;
  const isRunning =
    status !== undefined &&
    getRunStatePollInterval({ status, sseConnected: false }) !== false;

  return (
    <LangyCapabilityCard
      tone="read"
      surface={surface}
      overline={overline}
      title={
        <HStack gap={2} align="center" flexWrap="wrap">
          <Text textStyle="xs" fontWeight="640" color="fg" lineHeight="1.3">
            {title || "Simulation run"}
          </Text>
          {statusConfig ? (
            <Badge
              size="sm"
              variant="subtle"
              colorPalette={statusConfig.colorPalette}
            >
              {isRunning ? <Spinner size="xs" color="currentColor" /> : null}
              {statusConfig.label}
            </Badge>
          ) : (
            <Spinner size="xs" color="fg.subtle" />
          )}
        </HStack>
      }
      projectSlug={projectSlug}
      resourceId={resourceId}
      platformUrl={platformUrl}
    >
      {messages ? (
        <Box
          as="button"
          onClick={onOpen}
          cursor="pointer"
          textAlign="left"
          width="full"
          maxHeight="130px"
          overflow="hidden"
          position="relative"
          aria-label={`View details for ${title || "simulation run"}`}
          // Fade the preview's cut edge into the card ground instead of
          // clipping a message blob mid-line.
          _after={{
            content: '""',
            position: "absolute",
            insetInline: 0,
            bottom: 0,
            height: "26px",
            background: "linear-gradient(transparent, var(--chakra-colors-bg-subtle))",
            pointerEvents: "none",
          }}
        >
          <MessagePreview
            messages={messages}
            streamingMessages={streamingMessages}
          />
        </Box>
      ) : null}
    </LangyCapabilityCard>
  );
}
