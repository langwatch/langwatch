import { Link } from "../ui/link";
import {
  Avatar,
  Box,
  Button,
  Drawer,
  DrawerCloseButton,
  Heading,
  HStack,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverCloseButton,
  PopoverContent,
  PopoverTrigger,
  Spacer,
  Tab,
  Table,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip,
  Tr,
  useDisclosure,
  useToast,
  VStack,
} from "@chakra-ui/react";
import { type Project, type PublicShare } from "@prisma/client";
import { useRouter } from "next/router";
import qs from "qs";
import { useCallback, useEffect, useState } from "react";
import { Maximize2, Minimize2, Plus, Users } from "react-feather";
import type { ElasticSearchEvaluation } from "~/server/tracer/types";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useTraceDetailsState } from "../../hooks/useTraceDetailsState";
import { Conversation } from "../../pages/[project]/messages/[trace]/index";
import { TeamRoleGroup } from "../../server/api/permission";
import { api } from "../../utils/api";
import { formatTimeAgo } from "../../utils/formatTimeAgo";
import { evaluationPassed } from "../checks/EvaluationStatus";
import { useDrawer } from "../CurrentDrawer";
import { EvaluationStatusItem } from "./EvaluationStatusItem";
import { ShareButton } from "./ShareButton";
import { SpanTree } from "./SpanTree";
import { TraceSummary } from "./Summary";

import { chakraComponents, Select as MultiSelect } from "chakra-react-select";
import { useAnnotationCommentStore } from "../../hooks/useAnnotationCommentStore";
import { AddAnnotationQueueDrawer } from "../AddAnnotationQueueDrawer";

interface TraceEval {
  project?: Project;
  traceId: string;
  evaluations?: ElasticSearchEvaluation[];
}

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

  const toast = useToast();
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
          toast({
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
            status: "success",
            isClosable: true,
            position: "top-right",
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
      background="white"
      gap={0}
    >
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

              <DrawerCloseButton zIndex={1} />
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
                <Popover
                  isOpen={popover.isOpen}
                  onOpen={popover.onOpen}
                  onClose={popover.onClose}
                >
                  <PopoverTrigger>
                    <Button colorPalette="black" variant="outline">
                      Annotation Queue
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent zIndex="2222">
                    <PopoverArrow />
                    <PopoverCloseButton />
                    <PopoverBody>
                      <AddParticipants
                        options={options}
                        annotators={annotators}
                        setAnnotators={setAnnotators}
                        queueDrawerOpen={queueDrawerOpen}
                        sendToQueue={sendToQueue}
                        isLoading={queueItem.isLoading}
                      />
                    </PopoverBody>
                  </PopoverContent>
                </Popover>
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
        <Tabs width="full" index={tabIndex} onChange={setTabIndex}>
          <TabList paddingX={6}>
            {canViewMessages && <Tab>Messages</Tab>}
            <Tab>Trace Details</Tab>
            {anyGuardrails && (
              <Tab>
                Guardrails{" "}
                <Blocked
                  project={project}
                  traceId={props.traceId}
                  evaluations={evaluations.data}
                />
              </Tab>
            )}
            <Tab>
              Evaluations{" "}
              <EvaluationsCount
                project={project}
                traceId={props.traceId}
                evaluations={evaluations.data}
              />
            </Tab>

            <Tab>
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
            </Tab>
          </TabList>
        </Tabs>
      </VStack>
      <Tabs width="full" index={tabIndex} onChange={setTabIndex}>
        <TabPanels>
          {canViewMessages && (
            <TabPanel paddingX={0} padding={0} paddingTop={2}>
              {tabIndex === indexes.messages && (
                <Conversation threadId={threadId} traceId={props.traceId} />
              )}
            </TabPanel>
          )}
          <TabPanel paddingX={6} paddingY={0}>
            {tabIndex === indexes.traceDetails && (
              <>
                <TraceSummary traceId={props.traceId} />
                <SpanTree traceId={props.traceId} />
              </>
            )}
          </TabPanel>
          {anyGuardrails && (
            <TabPanel paddingX={6} paddingY={4}>
              {tabIndex === indexes.guardrails && (
                <Guardrails
                  project={project}
                  traceId={props.traceId ?? ""}
                  evaluations={evaluations.data}
                />
              )}
            </TabPanel>
          )}
          <TabPanel paddingX={6} paddingY={4}>
            {tabIndex === indexes.evaluations && (
              <Evaluations
                project={project}
                traceId={props.traceId ?? ""}
                evaluations={evaluations.data}
                anyGuardrails={anyGuardrails}
              />
            )}
          </TabPanel>

          <TabPanel paddingX={6} paddingY={4}>
            {tabIndex === indexes.events && <Events traceId={props.traceId} />}
          </TabPanel>
        </TabPanels>
      </Tabs>

      <Drawer
        isOpen={queueDrawerOpen.isOpen}
        placement="right"
        size={"lg"}
        onClose={queueDrawerOpen.onClose}
        onOverlayClick={queueDrawerOpen.onClose}
      >
        <AddAnnotationQueueDrawer
          onClose={queueDrawerOpen.onClose}
          onOverlayClick={queueDrawerOpen.onClose}
        />
      </Drawer>
    </VStack>
  );
}

const AddParticipants = ({
  options,
  annotators,
  setAnnotators,
  queueDrawerOpen,
  sendToQueue,
  isLoading,
}: {
  options: any[];
  annotators: any[];
  setAnnotators: any;
  queueDrawerOpen: any;
  sendToQueue: () => void;
  isLoading: boolean;
}) => {
  return (
    <>
      <VStack width="full" align="start">
        <Text>Send to:</Text>
        <Box
          border="1px solid lightgray"
          borderRadius={5}
          paddingX={1}
          minWidth="300px"
        >
          <MultiSelect
            options={options}
            onChange={(newValue) => {
              setAnnotators(
                newValue.map((v) => ({
                  id: v.value,
                  name: v.label,
                }))
              );
            }}
            value={annotators.map((p) => ({
              value: p.id,
              label: p.name ?? "",
            }))}
            isMulti
            closeMenuOnSelect={false}
            selectedOptionStyle="check"
            hideSelectedOptions={true}
            useBasicStyles
            variant="unstyled"
            placeholder="Add Participants"
            components={{
              Menu: ({ children, ...props }) => (
                <chakraComponents.Menu
                  {...props}
                  innerProps={{
                    ...props.innerProps,
                    style: { width: "300px" },
                  }}
                >
                  {children}
                </chakraComponents.Menu>
              ),
              Option: ({ children, ...props }) => (
                <chakraComponents.Option {...props}>
                  <VStack align="start">
                    <HStack>
                      {props.data.value.startsWith("user-") ? (
                        <Avatar
                          name={props.data.label}
                          color="white"
                          size="xs"
                        />
                      ) : (
                        <Box padding={1}>
                          <Users size={18} />
                        </Box>
                      )}
                      <Text>{children}</Text>
                    </HStack>
                  </VStack>
                </chakraComponents.Option>
              ),
              MultiValueLabel: ({ children, ...props }) => (
                <chakraComponents.MultiValueLabel {...props}>
                  <VStack align="start" padding={1} paddingX={0}>
                    <HStack>
                      {props.data.value.startsWith("user-") ? (
                        <Avatar
                          name={props.data.label}
                          color="white"
                          size="xs"
                        />
                      ) : (
                        <Box padding={1}>
                          <Users size={18} />
                        </Box>
                      )}
                      <Text>{children}</Text>
                    </HStack>
                  </VStack>
                </chakraComponents.MultiValueLabel>
              ),
              MenuList: (props) => (
                <chakraComponents.MenuList {...props} maxHeight={300}>
                  <Box
                    maxH="250px"
                    overflowY="auto"
                    css={{
                      "&::-webkit-scrollbar": {
                        display: "none",
                      },
                      msOverflowStyle: "none", // IE and Edge
                      scrollbarWidth: "none", // Firefox
                    }}
                  >
                    {props.children}
                  </Box>
                  <Box
                    p={2}
                    position="sticky"
                    bottom={0}
                    bg="white"
                    borderTop="1px solid"
                    borderColor="gray.100"
                  >
                    <Button
                      width="100%"
                      colorPalette="blue"
                      onClick={queueDrawerOpen.onOpen}
                      leftIcon={<Plus />}
                      variant="outline"
                      size="sm"
                    >
                      Add New Queue
                    </Button>
                  </Box>
                </chakraComponents.MenuList>
              ),
            }}
          />
        </Box>
        <Spacer />
        <HStack width="full">
          <Spacer />
          <Button
            colorPalette="orange"
            size="sm"
            onClick={sendToQueue}
            isLoading={isLoading}
          >
            Send
          </Button>
        </HStack>
      </VStack>
    </>
  );
};
function Events({ traceId }: { traceId: string }) {
  const { trace } = useTraceDetailsState(traceId);

  return trace.data && (trace.data?.events ?? []).length == 0 ? (
    <Text>
      No events found.{" "}
      <Link
        href="https://docs.langwatch.ai/user-events/custom"
        target="_blank"
        textDecoration="underline"
      >
        Get started with events
      </Link>
      .
    </Text>
  ) : (
    <VStack align="start">
      {trace.data?.events?.map((event) => (
        <VStack
          key={event.event_id}
          backgroundColor={"gray.100"}
          width={"full"}
          padding={6}
          borderRadius={"lg"}
          align="start"
          gap={4}
        >
          <HStack width="full">
            <Heading size="md">{event.event_type}</Heading>
            <Spacer />
            {event.timestamps.started_at && (
              <Tooltip
                label={new Date(event.timestamps.started_at).toLocaleString()}
              >
                <Text color="gray.400" borderBottom="1px dashed">
                  {formatTimeAgo(event.timestamps.started_at)}
                </Text>
              </Tooltip>
            )}
          </HStack>
          <Box
            borderRadius="6px"
            border="1px solid"
            borderColor="gray.400"
            width="full"
          >
            <Table
              size="sm"
              background="white"
              borderRadius="6px"
              border="none"
            >
              <Thead>
                <Tr>
                  <Th width="50%">Metric</Th>
                  <Th width="50%">Value</Th>
                </Tr>
              </Thead>
              <Tbody>
                {Object.entries(event.metrics ?? {}).map(([key, value]) => (
                  <Tr key={key}>
                    <Td>{key}</Td>
                    <Td>{value}</Td>
                  </Tr>
                ))}
              </Tbody>
              <Thead>
                <Tr>
                  <Th>Event Detail</Th>
                  <Th>Value</Th>
                </Tr>
              </Thead>
              <Tbody>
                {Object.entries(event.event_details ?? {}).map(
                  ([key, value]) => (
                    <Tr key={key}>
                      <Td>{key}</Td>
                      <Td>{value}</Td>
                    </Tr>
                  )
                )}
              </Tbody>
            </Table>
          </Box>
        </VStack>
      ))}
    </VStack>
  );
}

function Evaluations(trace: TraceEval & { anyGuardrails: boolean }) {
  const evaluations = trace.evaluations?.filter((x) => !x.is_guardrail);
  const totalChecks = evaluations?.length;
  if (!totalChecks)
    return (
      <Text>
        No evaluations ran for this message.{" "}
        {trace.anyGuardrails ? (
          "Evaluations are skipped if guardrails completely blocked the message."
        ) : (
          <>
            Setup evaluations{" "}
            <Link
              href={`/${trace.project?.slug}/evaluations`}
              textDecoration="underline"
            >
              here
            </Link>
            .
          </>
        )}
      </Text>
    );
  return (
    <VStack align="start" gap={2}>
      <>
        {evaluations?.map((evaluation) => (
          <EvaluationStatusItem
            key={evaluation.evaluation_id}
            check={evaluation}
          />
        ))}
      </>
    </VStack>
  );
}

const Guardrails = (trace: TraceEval) => {
  const guardrails = trace.evaluations?.filter((x) => x.is_guardrail);
  const totalChecks = guardrails?.length;
  if (!totalChecks)
    return (
      <Text>
        No guardrails ran for this message. Setup guardrails{" "}
        <Link
          href={`/${trace.project?.slug}/evaluations`}
          textDecoration="underline"
        >
          here
        </Link>
        .
      </Text>
    );
  return (
    <VStack align="start" gap={2}>
      <>
        {guardrails?.map((evaluation) => (
          <EvaluationStatusItem
            key={evaluation.evaluation_id}
            check={evaluation}
          />
        ))}
      </>
    </VStack>
  );
};

const EvaluationsCount = (trace: TraceEval) => {
  const totalErrors =
    trace.evaluations?.filter(
      (check) => check.status === "error" || evaluationPassed(check) === false
    ).length ?? 0;

  if (totalErrors > 0) {
    return (
      <Text
        marginLeft={3}
        borderRadius={"md"}
        paddingX={2}
        backgroundColor={"red.500"}
        color={"white"}
        fontSize={"sm"}
      >
        {totalErrors} failed
      </Text>
    );
  }

  const totalProcessed =
    trace.evaluations?.filter((check) => check.status === "processed").length ??
    0;
  const total = trace.evaluations?.length ?? 0;

  if (total === 0) return null;

  return (
    <Text
      marginLeft={3}
      borderRadius={"md"}
      paddingX={2}
      backgroundColor={totalProcessed > 0 ? "green.500" : "yellow.500"}
      color={"white"}
      fontSize={"sm"}
    >
      {totalProcessed > 0 ? totalProcessed : total}
    </Text>
  );
};

const Blocked = (trace: TraceEval) => {
  const totalBlocked = trace
    ? trace.evaluations?.filter(
        (check) => check.is_guardrail && check.passed === false
      ).length
    : 0;

  if (totalBlocked === 0 || !totalBlocked) return null;

  return (
    <Text
      marginLeft={3}
      borderRadius={"md"}
      paddingX={2}
      backgroundColor={"blue.100"}
      fontSize={"sm"}
    >
      {totalBlocked} blocked
    </Text>
  );
};
