import {
  Button,
  Heading,
  HStack,
  Tabs,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import type { PublicShare } from "@prisma/client";
import { useRouter } from "next/router";
import qs from "qs";
import { useCallback, useEffect, useState } from "react";
import { Maximize2, Minimize2 } from "react-feather";
import { useDrawer } from "~/hooks/useDrawer";
import { useAnnotationCommentStore } from "../../hooks/useAnnotationCommentStore";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useTraceDetailsState } from "../../hooks/useTraceDetailsState";
import { api } from "../../utils/api";
import { AddAnnotationQueueDrawer } from "../AddAnnotationQueueDrawer";
import { Conversation } from "../messages/Conversation";
import { Drawer } from "../ui/drawer";
import { Link } from "../ui/link";
import { Popover } from "../ui/popover";
import { toaster } from "../ui/toaster";
import { AddParticipants } from "./AddParticipants";
import {
  Blocked,
  Evaluations,
  EvaluationsCount,
  Guardrails,
} from "./Evaluations";
import { Events } from "./Events";
import { SequenceDiagramContainer } from "./SequenceDiagram";
import { ShareButton } from "./ShareButton";
import { SpanTree } from "./SpanTree";
import { TraceSummary } from "./Summary";

export function TraceDetails(props: {
  traceId: string;
  selectedTab?: string;
  publicShare?: PublicShare;
  traceView?: "span" | "full";
  showMessages?: boolean;
  onToggleView?: () => void;
}) {
  const { project, hasPermission } = useOrganizationTeamProject();
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const router = useRouter();
  const queryClient = api.useContext();

  const canViewMessages = true;

  const { openDrawer, closeDrawer } = useDrawer();
  const { trace } = useTraceDetailsState(props.traceId);

  const [evaluationsCheckInterval, setEvaluationsCheckInterval] = useState<
    number | undefined
  >();
  const [evaluationsPollingStart] = useState(() => Date.now());

  const evaluations = api.traces.getEvaluations.useQuery(
    { projectId: project?.id ?? "", traceId: props.traceId },
    {
      enabled: !!project,
      refetchInterval: evaluationsCheckInterval,
      refetchOnWindowFocus: false,
    },
  );

  useEffect(() => {
    if (!evaluations.data) return;

    const now = Date.now();
    const pollingTooLong = now - evaluationsPollingStart > 5 * 60 * 1000;

    // Give up after 5 minutes of polling
    if (pollingTooLong) {
      setEvaluationsCheckInterval(undefined);
      return;
    }

    const hasPendingEvals = evaluations.data.some(
      (check) =>
        (check.status === "scheduled" || check.status === "in_progress") &&
        (check.timestamps.inserted_at ?? 0) > now - 1000 * 60 * 60,
    );

    const traceIsFresh =
      trace.data?.timestamps.inserted_at &&
      now - trace.data.timestamps.inserted_at < 2 * 60 * 1000;

    const noEvalsYetOnFreshTrace =
      evaluations.data.length === 0 && traceIsFresh;

    if (hasPendingEvals || noEvalsYetOnFreshTrace) {
      setEvaluationsCheckInterval(2000);
    } else {
      setEvaluationsCheckInterval(undefined);
    }
  }, [evaluations.data, evaluationsPollingStart, trace.data?.timestamps.inserted_at]);

  const anyGuardrails = !!evaluations.data?.some((x) => x.is_guardrail);

  const availableTabs = [
    ...(canViewMessages ? ["messages"] : []),
    "traceDetails",
    "sequenceDiagram",
    ...(anyGuardrails ? ["guardrails"] : []),
    "evaluations",
    "events",
  ];

  const [selectedTab, setSelectedTab_] = useState(availableTabs[0]);

  const setSelectedTab = useCallback(
    (tab: string) => {
      setSelectedTab_(tab);
      if (router.query["drawer.selectedTab"] == tab) {
        return;
      }
      setTimeout(() => {
        void router.replace(
          "?" +
          qs.stringify(
            {
              ...Object.fromEntries(
                Object.entries(router.query).filter(
                  ([key]) => !key.startsWith("drawer.selectedTab"),
                ),
              ),
              drawer: {
                selectedTab: tab,
              },
            },
            { allowDots: true },
          ),
        );
      }, 100);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedTab],
  );

  useEffect(() => {
    if (props.selectedTab) {
      setSelectedTab_(props.selectedTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedTab]);

  const queueDrawerOpen = useDisclosure();

  const queueItem = api.annotation.createQueueItem.useMutation();
  const [open, setOpen] = useState(false);

  const sendToQueue = () => {
    queueItem.mutate(
      {
        projectId: project?.id ?? "",
        traceIds: [props.traceId],
        annotators: annotators.map((p) => p.id),
      },
      {
        onSuccess: () => {
          // Invalidate count queries to update sidebar counts
          void queryClient.annotation.getPendingItemsCount.invalidate();
          void queryClient.annotation.getAssignedItemsCount.invalidate();
          void queryClient.annotation.getQueueItemsCounts.invalidate();

          setOpen(false);
          toaster.create({
            title: "Trace added to annotation queue",
            description: (
              <>
                <Link
                  href={`/${project?.slug}/annotations/`}
                  textDecoration="underline"
                >
                  View Queues
                </Link>
              </>
            ),
            type: "success",
            meta: {
              closable: true,
            },
          });
        },
      },
    );
  };

  const [annotators, setAnnotators] = useState<{ id: string; name: string }[]>(
    [],
  );

  useEffect(() => {
    if (trace.data?.metadata.thread_id) {
      setThreadId(trace.data.metadata.thread_id);
    }
  }, [trace.data?.metadata.thread_id]);

  const commentState = useAnnotationCommentStore();

  return (
    <VStack align="start" width="full" height="full" gap={0}>
      <Tabs.Root
        width="full"
        height="full"
        value={selectedTab}
        onValueChange={(change) => setSelectedTab(change.value)}
        colorPalette="blue"
        display="flex"
        flexDirection="column"
      >
        <VStack
          width="full"
          gap={0}
          position="sticky"
          top={0}
          zIndex={2}
          align="start"
          background="bg.panel/75"
          backdropFilter="blur(8px)"
          borderTopRadius="lg"
        >
          <HStack
            width="full"
            paddingTop={2}
            paddingBottom={6}
            paddingLeft={6}
            paddingRight={12}
            justify="space-between"
          >
            <Heading paddingTop={2}>Trace Details</Heading>
            <HStack>
              {hasPermission("annotations:manage") && (
                <Button
                  data-scope="header"
                  colorPalette="gray"
                  onClick={() => {
                    commentState.setCommentState({
                      traceId: props.traceId,
                      action: "new",
                      annotationId: undefined,
                    });
                    if (!canViewMessages) {
                      closeDrawer();
                    } else {
                      setSelectedTab("messages");
                    }
                  }}
                >
                  Annotate
                </Button>
              )}
              {hasPermission("annotations:manage") && (
                <>
                  <Popover.Root
                    modal
                    onOpenChange={(e) => setOpen(e.open)}
                    open={open}
                  >
                    <Popover.Trigger asChild>
                      <Button data-scope="header" colorPalette="gray">
                        Annotation Queue
                      </Button>
                    </Popover.Trigger>
                    <Popover.Content
                      display={queueDrawerOpen.open ? "none" : "block"}
                    >
                      <Popover.Arrow />
                      <Popover.CloseTrigger />
                      <Popover.Body>
                        {open && (
                          <AddParticipants
                            annotators={annotators}
                            setAnnotators={setAnnotators}
                            queueDrawerOpen={queueDrawerOpen}
                            sendToQueue={sendToQueue}
                            isLoading={queueItem.isLoading}
                          />
                        )}
                      </Popover.Body>
                    </Popover.Content>
                  </Popover.Root>
                </>
              )}
              {hasPermission("datasets:manage") && (
                <Button
                  type="submit"
                  data-scope="header"
                  colorPalette="gray"
                  minWidth="fit-content"
                  onClick={() => {
                    openDrawer("addDatasetRecord", {
                      traceId: props.traceId,
                    });
                  }}
                >
                  Add to Dataset
                </Button>
              )}
              {project && (
                <ShareButton project={project} traceId={props.traceId} />
              )}
              {props.onToggleView && (
                <>
                  <Button data-scope="header" colorPalette="gray">
                    {props.traceView === "span" ? (
                      <Maximize2
                        size={16}
                        onClick={props.onToggleView}
                        cursor={"pointer"}
                      />
                    ) : (
                      <Minimize2
                        size={16}
                        onClick={props.onToggleView}
                        cursor={"pointer"}
                      />
                    )}
                  </Button>
                  <Drawer.CloseTrigger />
                </>
              )}
            </HStack>
          </HStack>

          <Tabs.List paddingLeft={6} width="full">
            {canViewMessages && (
              <Tabs.Trigger value="messages">Thread</Tabs.Trigger>
            )}
            <Tabs.Trigger value="traceDetails">Trace Details</Tabs.Trigger>
            <Tabs.Trigger value="sequenceDiagram">Sequence</Tabs.Trigger>
            {anyGuardrails && (
              <Tabs.Trigger value="guardrails">
                Guardrails
                <EvaluationsCount
                  project={project}
                  traceId={props.traceId}
                  evaluations={evaluations.data}
                  countGuardrails
                />
                <Blocked
                  project={project}
                  traceId={props.traceId}
                  evaluations={evaluations.data}
                />
              </Tabs.Trigger>
            )}
            <Tabs.Trigger value="evaluations">
              Evaluations
              <EvaluationsCount
                project={project}
                traceId={props.traceId}
                evaluations={evaluations.data}
              />
            </Tabs.Trigger>
            <Tabs.Trigger value="events">
              Events
              {trace.data?.events && trace.data.events.length > 0 && (
                <Text
                  borderRadius={"md"}
                  paddingX={2}
                  backgroundColor={"green.500"}
                  color={"white"}
                  fontSize={"sm"}
                >
                  {trace.data.events.length}
                </Text>
              )}
            </Tabs.Trigger>
          </Tabs.List>
        </VStack>
        {canViewMessages && (
          <Tabs.Content
            value="messages"
            paddingX={0}
            padding={0}
            paddingY={6}
            background="bg.muted"
            flexGrow={1}
          >
            <Conversation threadId={threadId} traceId={props.traceId} />
          </Tabs.Content>
        )}
        <Tabs.Content value="traceDetails" paddingY={0}>
          {selectedTab === "traceDetails" && (
            <VStack paddingBottom={6}>
              <TraceSummary traceId={props.traceId} />
              <SpanTree traceId={props.traceId} />
            </VStack>
          )}
        </Tabs.Content>
        <Tabs.Content
          value="sequenceDiagram"
          paddingX={0}
          padding={0}
          paddingY={6}
          background="bg.muted"
          flexGrow={1}
        >
          {selectedTab === "sequenceDiagram" && (
            <SequenceDiagramContainer traceId={props.traceId} />
          )}
        </Tabs.Content>
        {anyGuardrails && (
          <Tabs.Content value="guardrails" paddingX={6} paddingY={4}>
            <Guardrails
              project={project}
              traceId={props.traceId ?? ""}
              evaluations={evaluations.data}
            />
          </Tabs.Content>
        )}
        <Tabs.Content value="evaluations" paddingX={6} paddingY={4}>
          <Evaluations
            project={project}
            traceId={props.traceId ?? ""}
            evaluations={evaluations.data}
            anyGuardrails={anyGuardrails}
          />
        </Tabs.Content>
        <Tabs.Content value="events" paddingX={6} paddingY={4}>
          <Events traceId={props.traceId} />
        </Tabs.Content>
      </Tabs.Root>

      {queueDrawerOpen.open && (
        <AddAnnotationQueueDrawer
          open={queueDrawerOpen.open}
          onClose={queueDrawerOpen.onClose}
          onOverlayClick={queueDrawerOpen.onClose}
        />
      )}
    </VStack>
  );
}
