import { Link } from "@chakra-ui/next-js";
import {
  Box,
  Button,
  Heading,
  HStack,
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
  VStack,
} from "@chakra-ui/react";
import {
  type Annotation,
  type Project,
  type PublicShare,
} from "@prisma/client";
import type { ElasticSearchEvaluation } from "~/server/tracer/types";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { TeamRoleGroup } from "../../server/api/permission";
import { api } from "../../utils/api";
import { Annotations } from "../Annotations";
import { EvaluationStatusItem } from "./EvaluationStatusItem";
import { useDrawer } from "../CurrentDrawer";
import { ShareButton } from "./ShareButton";
import { SpanTree } from "./SpanTree";
import { TraceSummary } from "./Summary";
import { useEffect, useState } from "react";
import { useTraceDetailsState } from "../../hooks/useTraceDetailsState";
import { formatTimeAgo } from "../../utils/formatTimeAgo";

interface TraceEval {
  project?: Project;
  traceId: string;
  evaluations?: ElasticSearchEvaluation[];
}

export function TraceDetails(props: {
  traceId: string;
  annotationTab?: boolean;
  publicShare?: PublicShare;
}) {
  const { project, hasTeamPermission } = useOrganizationTeamProject();

  const { openDrawer } = useDrawer();

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

  const annotationsQuery = api.annotation.getByTraceId.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: props.traceId,
    },
    {
      enabled: !!project?.id,
    }
  );

  const anyGuardrails = !!evaluations.data?.some((x) => x.is_guardrail);

  const annotationTabIndex =
    props.annotationTab && anyGuardrails ? 3 : props.annotationTab ? 2 : 0;

  const { trace } = useTraceDetailsState(props.traceId);

  return (
    <>
      <VStack
        align="start"
        width="full"
        height="full"
        background="white"
        paddingX={6}
        gap={6}
      >
        <VStack align="start" width="full">
          <HStack width="full" marginTop={4}>
            <Text paddingTop={5} fontSize="2xl" fontWeight="600">
              Trace Details
            </Text>
            <Spacer />
            <HStack>
              {hasTeamPermission(TeamRoleGroup.ANNOTATIONS_MANAGE) && (
                <Button
                  colorScheme="black"
                  variant="outline"
                  onClick={() =>
                    openDrawer("annotation", {
                      traceId: props.traceId,
                      action: "new",
                    })
                  }
                >
                  Annotate
                </Button>
              )}
              {hasTeamPermission(TeamRoleGroup.DATASETS_MANAGE) && (
                <Button
                  colorScheme="black"
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
        </VStack>
        <VStack align="start" width="full">
          <Tabs width="full" defaultIndex={annotationTabIndex}>
            <TabList>
              <Tab>Details</Tab>
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
                Annotations{" "}
                {annotationsQuery.data && (
                  <AnnotationMsgs annotations={annotationsQuery.data} />
                )}
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

            <TabPanels>
              <TabPanel>
                <TraceSummary traceId={props.traceId} />
                <SpanTree traceId={props.traceId} />
              </TabPanel>
              {anyGuardrails && (
                <TabPanel>
                  <Guardrails
                    project={project}
                    traceId={props.traceId ?? ""}
                    evaluations={evaluations.data}
                  />
                </TabPanel>
              )}
              <TabPanel>
                <Evaluations
                  project={project}
                  traceId={props.traceId ?? ""}
                  evaluations={evaluations.data}
                  anyGuardrails={anyGuardrails}
                />
              </TabPanel>
              <TabPanel>
                {annotationsQuery.isLoading ? (
                  <Text>Loading...</Text>
                ) : annotationsQuery.data &&
                  annotationsQuery.data.length > 0 ? (
                  <Annotations traceId={props.traceId} />
                ) : (
                  <Text>
                    No annotations found.{" "}
                    <Link
                      href="https://docs.langwatch.ai/features/annotations"
                      target="_blank"
                      textDecoration="underline"
                    >
                      Get started with annotations
                    </Link>
                    .
                  </Text>
                )}
              </TabPanel>
              <TabPanel>
                <Events traceId={props.traceId} />
              </TabPanel>
            </TabPanels>
          </Tabs>
        </VStack>
      </VStack>
    </>
  );
}

function Events({ traceId }: { traceId: string }) {
  const { trace } = useTraceDetailsState(traceId);

  return trace.data?.events?.length == 0 ? (
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
                <Text
                  color="gray.400"
                  borderBottom="1px dashed"
                >
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
                {Object.entries(event.event_details ?? {}).map(([key, value]) => (
                  <Tr key={key}>
                    <Td>{key}</Td>
                    <Td>{value}</Td>
                  </Tr>
                ))}
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
    <VStack align="start" spacing={2}>
      <>
        {evaluations?.map((check) => (
          <EvaluationStatusItem
            key={check.trace_id + "/" + check.check_id}
            check={check}
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
    <VStack align="start" spacing={2}>
      <>
        {guardrails?.map((check) => (
          <EvaluationStatusItem
            key={check.trace_id + "/" + check.check_id}
            check={check}
          />
        ))}
      </>
    </VStack>
  );
};

const EvaluationsCount = (trace: TraceEval) => {
  const totalErrors =
    trace.evaluations?.filter(
      (check) => check.status === "error" || check.passed === false
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

const AnnotationMsgs = ({ annotations }: { annotations: Annotation[] }) => {
  if (!annotations.length) return null;

  return (
    <Text
      marginLeft={3}
      borderRadius={"md"}
      paddingX={2}
      backgroundColor={"green.500"}
      color={"white"}
      fontSize={"sm"}
    >
      {annotations.length}
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
