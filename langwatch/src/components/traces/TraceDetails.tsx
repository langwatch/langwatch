import {
  Button,
  HStack,
  Spacer,
  Tabs,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { type PublicShare } from "@prisma/client";
import { useRouter } from "next/router";
import qs from "qs";
import { useCallback, useEffect, useState } from "react";
import { Maximize2, Minimize2 } from "react-feather";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useTraceDetailsState } from "../../hooks/useTraceDetailsState";
import { TeamRoleGroup } from "../../server/api/permission";
import { api } from "../../utils/api";
import { useDrawer } from "../CurrentDrawer";
import { Conversation } from "../messages/Conversation";
import { Link } from "../ui/link";
import { Popover } from "../ui/popover";
import { toaster } from "../ui/toaster";
import { ShareButton } from "./ShareButton";
import { SpanTree } from "./SpanTree";
import { TraceSummary } from "./Summary";

import { useAnnotationCommentStore } from "../../hooks/useAnnotationCommentStore";
import { AddAnnotationQueueDrawer } from "../AddAnnotationQueueDrawer";
import { Drawer } from "../ui/drawer";
import { AddParticipants } from "./AddParticipants";
import {
  Blocked,
  Evaluations,
  EvaluationsCount,
  Guardrails,
} from "./Evaluations";
import { Events } from "./Events";

export function TraceDetails(props: {
  traceId: string;
  selectedTab?: string;
  publicShare?: PublicShare;
  traceView?: "span" | "full";
  showMessages?: boolean;
  onToggleView?: () => void;
}) {
  const { project, hasTeamPermission, organization } =
    useOrganizationTeamProject();
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const router = useRouter();

  const canViewMessages = props.showMessages ?? router.query.view == "table";

  const { openDrawer, closeDrawer } = useDrawer();

  const [evaluationsCheckInterval, setEvaluationsCheckInterval] = useState<
    number | undefined
  >();

  const evaluations = api.traces.getEvaluations.useQuery(
    { projectId: project?.id ?? "", traceId: props.traceId },
    {
      enabled: !!project,
      refetchInterval: evaluationsCheckInterval,
      refetchOnWindowFocus: false,
    }
  );

  const annotationQueues = api.annotation.getQueues.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project,
    }
  );

  const users =
    api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      {
        organizationId: organization?.id ?? "",
      },
      {
        enabled: !!organization,
      }
    );

  const userOptions = users.data?.members.map((member) => ({
    label: member.user.name ?? "",
    value: `user-${member.user.id}`,
  }));

  const queueOptions = annotationQueues.data?.map((queue) => ({
    label: queue.name ?? "",
    value: `queue-${queue.id}`,
  }));

  const options = [...(userOptions ?? []), ...(queueOptions ?? [])];

  useEffect(() => {
    if (evaluations.data) {
      const pendingChecks = evaluations.data.filter(
        (check) =>
          (check.status == "scheduled" || check.status == "in_progress") &&
          (check.timestamps.inserted_at ?? 0) >
            new Date().getTime() - 1000 * 60 * 60 * 1
      );
      if (pendingChecks.length > 0) {
        setEvaluationsCheckInterval(2000);
      } else {
        setEvaluationsCheckInterval(undefined);
      }
    }
  }, [evaluations.data]);

  const anyGuardrails = !!evaluations.data?.some((x) => x.is_guardrail);

  const availableTabs = [
    ...(canViewMessages ? ["messages"] : []),
    "traceDetails",
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
                    ([key]) => !key.startsWith("drawer.selectedTab")
                  )
                ),
                drawer: {
                  selectedTab: tab,
                },
              },
              { allowDots: true }
            )
        );
      }, 100);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedTab]
  );

  useEffect(() => {
    if (props.selectedTab) {
      setSelectedTab_(props.selectedTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedTab]);

  const { trace } = useTraceDetailsState(props.traceId);
  const queueDrawerOpen = useDisclosure();

  const queueItem = api.annotation.createQueueItem.useMutation();
  const [open, setOpen] = useState(false);

  const sendToQueue = () => {
    queueItem.mutate(
      {
        projectId: project?.id ?? "",
        traceId: props.traceId,
        annotators: annotators.map((p) => p.id),
      },
      {
        onSuccess: () => {
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
            placement: "top-end",
          });
        },
      }
    );
  };

  const [annotators, setAnnotators] = useState<
    { id: string; name: string | null }[]
  >([]);

  useEffect(() => {
    if (trace.data?.metadata.thread_id) {
      setThreadId(trace.data.metadata.thread_id);
    }
  }, [trace.data?.metadata.thread_id]);

  const commentState = useAnnotationCommentStore();

  return (
    <VStack
      align="start"
      width="full"
      height="full"
      backgroundColor="white"
      gap={0}
    >
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
          background="white"
          align="start"
        >
          {props.onToggleView && (
            <>
              <HStack width="full" paddingTop={4} paddingLeft={6}>
                {props.traceView === "span" ? (
                  <Maximize2 onClick={props.onToggleView} cursor={"pointer"} />
                ) : (
                  <Minimize2 onClick={props.onToggleView} cursor={"pointer"} />
                )}
                <Drawer.CloseTrigger />
              </HStack>
            </>
          )}
          <HStack width="full" paddingTop={4} paddingX={6} paddingBottom={6}>
            <Text paddingTop={2} fontSize="2xl" fontWeight="600">
              Message Details
            </Text>
            <Spacer />
            <HStack>
              {hasTeamPermission(TeamRoleGroup.ANNOTATIONS_MANAGE) && (
                <Button

                  variant="outline"
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
              {hasTeamPermission(TeamRoleGroup.ANNOTATIONS_MANAGE) && (
                <>
                  <Popover.Root
                    modal
                    onOpenChange={(e) => setOpen(e.open)}
                    open={open}
                  >
                    <Popover.Trigger asChild>
                      <Button variant="outline">
                        Annotation Queue
                      </Button>
                    </Popover.Trigger>
                    <Popover.Content
                      display={queueDrawerOpen.open ? "none" : "block"}
                    >
                      <Popover.Arrow />
                      <Popover.CloseTrigger />
                      <Popover.Body>
                        <AddParticipants
                          options={options}
                          annotators={annotators}
                          setAnnotators={setAnnotators}
                          queueDrawerOpen={queueDrawerOpen}
                          sendToQueue={sendToQueue}
                          isLoading={queueItem.isLoading}
                        />
                      </Popover.Body>
                    </Popover.Content>
                  </Popover.Root>
                </>
              )}
              {hasTeamPermission(TeamRoleGroup.DATASETS_MANAGE) && (
                <Button

                  type="submit"
                  variant="outline"
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
            </HStack>
          </HStack>

          <Tabs.List paddingLeft={6} width="full">
            {canViewMessages && (
              <Tabs.Trigger value="messages">Messages</Tabs.Trigger>
            )}
            <Tabs.Trigger value="traceDetails">Trace Details</Tabs.Trigger>
            {anyGuardrails && (
              <Tabs.Trigger value="guardrails">
                Guardrails
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
            background="gray.100"
            flexGrow={1}
          >
            <Conversation threadId={threadId} traceId={props.traceId} />
          </Tabs.Content>
        )}
        <Tabs.Content value="traceDetails" paddingX={6} paddingY={0}>
          {selectedTab === "traceDetails" && (
            <>
              <TraceSummary traceId={props.traceId} />
              <SpanTree traceId={props.traceId} />
            </>
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

      <AddAnnotationQueueDrawer
        open={queueDrawerOpen.open}
        onClose={queueDrawerOpen.onClose}
        onOverlayClick={queueDrawerOpen.onClose}
      />
    </VStack>
  );
}
