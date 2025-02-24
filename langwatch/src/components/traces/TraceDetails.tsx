import {
  Button,
  Dialog,
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

  const indexes = Object.fromEntries(
    [
      ...(canViewMessages ? ["messages"] : []),
      "traceDetails",
      ...(anyGuardrails ? ["guardrails"] : []),
      "evaluations",
      "events",
    ].map((tab, index) => [tab, index])
  );
  const tabByIndex = Object.keys(indexes);

  const defaultTabIndex = props.selectedTab ? indexes[props.selectedTab] : 0;

  const [tabIndex, setTabIndex_] = useState(defaultTabIndex);

  const setTabIndex = useCallback(
    (tabIndex: number) => {
      setTabIndex_(tabIndex);
      if (router.query["drawer.selectedTab"] == tabByIndex[tabIndex]) {
        return;
      }
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
                selectedTab: tabByIndex[tabIndex],
              },
            },
            { allowDots: true }
          )
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabIndex]
  );

  useEffect(() => {
    if (props.selectedTab) {
      setTabIndex_((tabIndex) => indexes[props.selectedTab!] ?? tabIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedTab]);

  const { trace } = useTraceDetailsState(props.traceId);
  const queueDrawerOpen = useDisclosure();

  const queueItem = api.annotation.createQueueItem.useMutation();

  const popover = useDisclosure();

  const sendToQueue = () => {
    queueItem.mutate(
      {
        projectId: project?.id ?? "",
        traceId: props.traceId,
        annotators: annotators.map((p) => p.id),
      },
      {
        onSuccess: () => {
          popover.onClose();
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
    <VStack align="start" width="full" height="full" background="white" gap={0}>
      <VStack
        width="full"
        gap={0}
        position="sticky"
        top={0}
        zIndex={2}
        background="white"
      >
        {props.onToggleView && (
          <>
            <HStack width="full" paddingTop={4} paddingLeft={6}>
              {props.traceView === "span" ? (
                <Maximize2 onClick={props.onToggleView} cursor={"pointer"} />
              ) : (
                <Minimize2 onClick={props.onToggleView} cursor={"pointer"} />
              )}
              <Dialog.CloseTrigger />
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
                colorPalette="black"
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
                    setTabIndex(indexes.messages ?? 0);
                  }
                }}
              >
                Annotate
              </Button>
            )}
            {hasTeamPermission(TeamRoleGroup.ANNOTATIONS_MANAGE) && (
              <>
                <Popover.Root
                  open={popover.open}
                  onOpenChange={({ open }) => popover.setOpen(open)}
                >
                  <Popover.Trigger>
                    <Button colorPalette="black" variant="outline">
                      Annotation Queue
                    </Button>
                  </Popover.Trigger>
                  <Popover.Content zIndex={2222}>
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
                colorPalette="black"
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
        <Tabs.Root
          width="full"
          value={String(tabIndex)}
          onValueChange={(val) => setTabIndex(Number(val))}
        >
          <Tabs.List>
            {canViewMessages && <Tabs.Trigger value="0">Messages</Tabs.Trigger>}
            <Tabs.Trigger value="1">Trace Details</Tabs.Trigger>
            {anyGuardrails && (
              <Tabs.Trigger value="2">
                Guardrails{" "}
                <Blocked
                  project={project}
                  traceId={props.traceId}
                  evaluations={evaluations.data}
                />
              </Tabs.Trigger>
            )}
            <Tabs.Trigger value="3">
              Evaluations{" "}
              <EvaluationsCount
                project={project}
                traceId={props.traceId}
                evaluations={evaluations.data}
              />
            </Tabs.Trigger>
            <Tabs.Trigger value="4">
              Events{" "}
              {trace.data?.events && trace.data.events.length > 0 && (
                <Text
                  marginLeft={3}
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
            <Tabs.Indicator />
          </Tabs.List>
          {canViewMessages && (
            <Tabs.Content value="0" paddingX={0} padding={0} paddingTop={2}>
              {tabIndex === indexes.messages && (
                <Conversation threadId={threadId} traceId={props.traceId} />
              )}
            </Tabs.Content>
          )}
          <Tabs.Content value="1" paddingX={6} paddingY={0}>
            {tabIndex === indexes.traceDetails && (
              <>
                <TraceSummary traceId={props.traceId} />
                <SpanTree traceId={props.traceId} />
              </>
            )}
          </Tabs.Content>
          {anyGuardrails && (
            <Tabs.Content value="2" paddingX={6} paddingY={4}>
              {tabIndex === indexes.guardrails && (
                <Guardrails
                  project={project}
                  traceId={props.traceId ?? ""}
                  evaluations={evaluations.data}
                />
              )}
            </Tabs.Content>
          )}
          <Tabs.Content value="3" paddingX={6} paddingY={4}>
            {tabIndex === indexes.evaluations && (
              <Evaluations
                project={project}
                traceId={props.traceId ?? ""}
                evaluations={evaluations.data}
                anyGuardrails={anyGuardrails}
              />
            )}
          </Tabs.Content>
          <Tabs.Content value="4" paddingX={6} paddingY={4}>
            {tabIndex === indexes.events && <Events traceId={props.traceId} />}
          </Tabs.Content>
        </Tabs.Root>
      </VStack>

      <Dialog.Root open={queueDrawerOpen.open} placement="bottom">
        <Dialog.Backdrop />
        <Dialog.Content>
          <AddAnnotationQueueDrawer
            onClose={queueDrawerOpen.onClose}
            onOverlayClick={queueDrawerOpen.onClose}
          />
        </Dialog.Content>
      </Dialog.Root>
    </VStack>
  );
}
