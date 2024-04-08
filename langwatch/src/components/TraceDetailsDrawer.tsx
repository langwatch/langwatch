import {
  Drawer,
  DrawerBody,
  Flex,
  Spacer,
  Button,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  HStack,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  VStack,
  useDisclosure,
} from "@chakra-ui/react";
import { useState } from "react";
import { Maximize2, Minimize2 } from "react-feather";
import type { TraceCheck } from "~/server/tracer/types";
import { CheckPassingDrawer } from "./CheckPassingDrawer";
import { SpanTree } from "./traces/SpanTree";
import { TraceSummary } from "./traces/Summary";
import { Link } from "@chakra-ui/next-js";
import { AddDatasetRecordDrawer } from "./AddDatasetRecordDrawer";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { api } from "../utils/api";
import { useDrawer } from "./CurrentDrawer";

interface TraceDetailsDrawerProps {
  traceId: string;
}

interface TraceEval {
  traceId: string;
  traceChecks?: Record<string, TraceCheck[]>;
}

export const TraceDetailsDrawer = (props: TraceDetailsDrawerProps) => {
  const { closeDrawer } = useDrawer();
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
            {process.env.NEXT_PUBLIC_FEATURE_DATASETS && (
              <Button
                colorScheme="black"
                type="submit"
                variant="outline"
                minWidth="fit-content"
                onClick={onOpen}
              >
                Add to Dataset
              </Button>
            )}
          </Flex>
        </DrawerHeader>
        <DrawerBody>
          <Tabs>
            <TabList>
              <Tab>Details</Tab>
              {anyGuardrails && (
                <Tab>
                  Guardrails{" "}
                  <Blocked
                    traceId={props.traceId ?? ""}
                    traceChecks={traceChecksQuery.data}
                  />
                </Tab>
              )}
              <Tab>
                Evaluations{" "}
                <Errors
                  traceId={props.traceId ?? ""}
                  traceChecks={traceChecksQuery.data}
                />
              </Tab>
            </TabList>

            <TabPanels>
              <TabPanel>
                <TraceSummary traceId={props.traceId ?? ""} />
                <SpanTree traceId={props.traceId ?? ""} />
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
            </TabPanels>
          </Tabs>
        </DrawerBody>
      </DrawerContent>
      <AddDatasetRecordDrawer
        isOpen={isOpen}
        onClose={onClose}
        traceId={props.traceId ?? ""}
      />
    </Drawer>
  );
};
