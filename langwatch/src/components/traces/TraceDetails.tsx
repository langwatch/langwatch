import { Link } from "@chakra-ui/next-js";
import {
  Button,
  HStack,
  Spacer,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  type Annotation,
  type Project,
  type PublicShare,
} from "@prisma/client";
import type { TraceCheck } from "~/server/tracer/types";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { TeamRoleGroup } from "../../server/api/permission";
import { api } from "../../utils/api";
import { Annotations } from "../Annotations";
import { CheckPassingDrawer } from "../CheckPassingDrawer";
import { useDrawer } from "../CurrentDrawer";
import { ShareButton } from "./ShareButton";
import { SpanTree } from "./SpanTree";
import { TraceSummary } from "./Summary";
import { useEffect, useState } from "react";

interface TraceEval {
  project?: Project;
  traceId: string;
  evaluations?: TraceCheck[];
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
            </TabList>

            <TabPanels>
              <TabPanel>
                {/* <TraceSummary traceId={props.traceId} /> */}
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
                  <Text>No annotations found</Text>
                )}
              </TabPanel>
            </TabPanels>
          </Tabs>
        </VStack>
      </VStack>
    </>
  );
}

const Evaluations = (trace: TraceEval & { anyGuardrails: boolean }) => {
  const evaluations = trace.evaluations?.filter((x) => !x.is_guardrail);
  const totalChecks = evaluations?.length;
  if (!totalChecks)
    return (
      <Text>
        No evaluations ran for this message.
        {trace.anyGuardrails ? (
          " Evaluations are skipped if guardrails completely blocked the message."
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
          <CheckPassingDrawer
            key={check.trace_id + "/" + check.check_id}
            check={check}
          />
        ))}
      </>
    </VStack>
  );
};

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
          <CheckPassingDrawer
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
