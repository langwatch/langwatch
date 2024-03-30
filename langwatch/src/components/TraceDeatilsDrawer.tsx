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

interface TraceDetailsDrawerProps {
  isDrawerOpen: boolean;
  closeDrawer: () => void;
  traceId: string;
}

interface TraceEval {
  traceId: string;
  traceChecks?: Record<string, TraceCheck[]>;
}

export const TraceDeatilsDrawer = (props: TraceDetailsDrawerProps) => {
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

  const Evaluations = (trace: TraceEval) => {
    const totalChecks = trace.traceChecks?.[trace.traceId]?.length;
    if (!totalChecks)
      return (
        <Text>
          No evaluations ran for this message. Setup some gaurdrails{" "}
          <Link href={`/${String(project)}/guardrails`}>here.</Link>
        </Text>
      );
    return (
      <VStack align="start" spacing={2}>
        <>
          {trace.traceChecks?.[trace.traceId]?.map((check) => (
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
          (check) => check.status === "error" || check.passed === false
        ).length
      : 0;

    if (totalErrors === 0 || !totalErrors) return null;
    const errorText = totalErrors ?? 0 > 1 ? "errors" : "error";

    return (
      <Text
        marginLeft={3}
        borderRadius={"md"}
        paddingX={2}
        backgroundColor={"red.500"}
        color={"white"}
        fontSize={"sm"}
      >
        {totalErrors} {errorText}
      </Text>
    );
  };

  return (
    <Drawer
      isOpen={props.isDrawerOpen}
      blockScrollOnMount={false}
      placement="right"
      size={traceView}
      onClose={() => {
        props.closeDrawer();
        setTraceView("span");
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
