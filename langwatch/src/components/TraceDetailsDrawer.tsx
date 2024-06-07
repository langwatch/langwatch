import { Link } from "@chakra-ui/next-js";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  Flex,
  HStack,
  Spacer,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  VStack,
  useDisclosure
} from "@chakra-ui/react";
import type { Annotation } from "@prisma/client";
import { useState } from "react";
import { Maximize2, Minimize2 } from "react-feather";
import type { TraceCheck } from "~/server/tracer/types";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { api } from "../utils/api";
import { AddDatasetRecordDrawerV2 } from "./AddDatasetRecordDrawer";
import { Annotations } from "./Annotations";
import { CheckPassingDrawer } from "./CheckPassingDrawer";
import { useDrawer } from "./CurrentDrawer";
import { SpanTree } from "./traces/SpanTree";
import { TraceSummary } from "./traces/Summary";

interface TraceDetailsDrawerProps {
  traceId: string;
  annotationTab?: boolean;
}

interface TraceEval {
  traceId: string;
  traceChecks?: Record<string, TraceCheck[]>;
}

export const TraceDetailsDrawer = (props: TraceDetailsDrawerProps) => {
  const { closeDrawer, openDrawer } = useDrawer();
  const { isOpen, onOpen, onClose } = useDisclosure();

  const [traceView, setTraceView] = useState<"span" | "full">("span");
  const toggleView = () => {
    setTraceView((prevView) => (prevView === "span" ? "full" : "span"));
  };

  const { project } = useOrganizationTeamProject();

  const traceChecksQuery = api.traces.getTraceChecks.useQuery(
    { projectId: project?.id ?? "", traceIds: [props.traceId] },
    {
      enabled: !!project,
      refetchInterval: undefined,
      refetchOnWindowFocus: false,
    }
  );

  const annotationsQuery = api.annotation.getByTraceId.useQuery({
    projectId: project?.id ?? "",
    traceId: props.traceId,
  });

  const anyGuardrails = traceChecksQuery.data?.[props.traceId]?.some(
    (x) => x.is_guardrail
  );

  const Evaluations = (trace: TraceEval) => {
    const evaluations = trace.traceChecks?.[trace.traceId]?.filter(
      (x) => !x.is_guardrail
    );
    const totalChecks = evaluations?.length;
    if (!totalChecks)
      return (
        <Text>
          No evaluations ran for this message.
          {anyGuardrails ? (
            " Evaluations are skipped if guardrails completely blocked the message."
          ) : (
            <>
              Setup evaluations{" "}
              <Link
                href={`/${project?.slug}/evaluations`}
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
    const guardrails = trace.traceChecks?.[trace.traceId]?.filter(
      (x) => x.is_guardrail
    );
    const totalChecks = guardrails?.length;
    if (!totalChecks)
      return (
        <Text>
          No guardrails ran for this message. Setup guardrails{" "}
          <Link
            href={`/${project?.slug}/evaluations`}
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

  const Errors = (trace: TraceEval) => {
    const totalErrors = trace
      ? trace.traceChecks?.[trace.traceId]?.filter(
          (check) =>
            !check.is_guardrail &&
            (check.status === "error" || check.passed === false)
        ).length
      : 0;

    if (totalErrors === 0 || !totalErrors) return null;

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
      ? trace.traceChecks?.[trace.traceId]?.filter(
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

  return (
    <Drawer
      isOpen={true}
      blockScrollOnMount={false}
      placement="right"
      size={traceView}
      onClose={() => {
        closeDrawer();
      }}
    >
      <DrawerContent>
        <DrawerHeader>
          <HStack>
            {traceView === "span" ? (
              <Maximize2 onClick={toggleView} cursor={"pointer"} />
            ) : (
              <Minimize2 onClick={toggleView} cursor={"pointer"} />
            )}

            <DrawerCloseButton />
          </HStack>
          <Flex marginTop={4}>
            <Text paddingTop={5} fontSize="2xl">
              Trace Details
            </Text>
            <Spacer />
            <HStack>
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
              <Button
                colorScheme="black"
                type="submit"
                variant="outline"
                minWidth="fit-content"
                onClick={onOpen}
              >
                Add to Dataset
              </Button>
            </HStack>
          </Flex>
        </DrawerHeader>
        <DrawerBody>
          <Tabs defaultIndex={props.annotationTab ? 2 : 0}>
            <TabList>
              <Tab>Details</Tab>
              {anyGuardrails && (
                <Tab>
                  Guardrails{" "}
                  <Blocked
                    traceId={props.traceId}
                    traceChecks={traceChecksQuery.data}
                  />
                </Tab>
              )}
              <Tab>
                Evaluations{" "}
                <Errors
                  traceId={props.traceId}
                  traceChecks={traceChecksQuery.data}
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
                <TraceSummary traceId={props.traceId} />
                <SpanTree traceId={props.traceId} />
              </TabPanel>
              {anyGuardrails && (
                <TabPanel>
                  <Guardrails
                    traceId={props.traceId ?? ""}
                    traceChecks={traceChecksQuery.data}
                  />
                </TabPanel>
              )}
              <TabPanel>
                <Evaluations
                  traceId={props.traceId ?? ""}
                  traceChecks={traceChecksQuery.data}
                />
              </TabPanel>
              <TabPanel>
                {annotationsQuery.data && annotationsQuery.data.length > 0 ? (
                  <Annotations traceId={props.traceId} />
                ) : (
                  <Text>No annotations found</Text>
                )}
              </TabPanel>
            </TabPanels>
          </Tabs>
        </DrawerBody>
      </DrawerContent>
      <AddDatasetRecordDrawerV2
        isOpen={isOpen}
        onClose={onClose}
        traceId={props.traceId ?? ""}
      />
    </Drawer>
  );
};
