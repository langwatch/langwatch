import { Drawer, DrawerBody, DrawerCloseButton, DrawerContent, DrawerHeader, HStack, Tab, TabList, TabPanel, TabPanels, Tabs, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { Maximize2, Minimize2 } from "react-feather";
import type { TraceCheck } from "~/server/tracer/types";
import { CheckPassingDrawer } from "./CheckPassingDrawer";
import { SpanTree } from "./traces/SpanTree";
import { TraceSummary } from "./traces/Summary";


interface TraceDetailsDrawerProps {
    isDrawerOpen: boolean;
    setIsDrawerOpen: (isOpen: boolean) => void;
    totalErrors: number;
    traceId?: string;
    traceChecksQuery?: any
}

interface TraceEval {
    traceId: string;
    traceChecks?: Record<string, TraceCheck[]>;
}

export const TraceDeatilsDrawer = (props: TraceDetailsDrawerProps) => {
    const [traceView, setTraceView] = useState<"span" | "full">("span");
    const toggleView = () => {
        setTraceView((prevView) => (prevView === "span" ? "full" : "span"));
    };

    const Evaluations = (trace: TraceEval) => {
        return (
            <VStack align="start" spacing={2}>
                {trace.traceChecks?.[trace.traceId]?.map((check) => (
                    <CheckPassingDrawer
                        key={check.trace_id + "/" + check.check_id}
                        check={check}
                    />
                ))}
            </VStack>
        );
    };

    const errors = () => {
        if (props.totalErrors == 0) return;

        const errorText = props.totalErrors > 1 ? "errors" : "error";
        return (
            <Text
                marginLeft={3}
                borderRadius={"md"}
                paddingX={2}
                backgroundColor={"red.500"}
                color={"white"}
                fontSize={"sm"}
            >
                {props.totalErrors} {errorText}
            </Text>
        );
    };

    return (
        <Drawer
            isOpen={props.isDrawerOpen}
            placement="right"
            size={traceView}
            onClose={() => {
                props.setIsDrawerOpen(false);
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
                    <HStack>
                        <Text paddingTop={5} fontSize="2xl">
                            Trace Details
                        </Text>
                    </HStack>
                </DrawerHeader>
                <DrawerBody>
                    <Tabs>
                        <TabList>
                            <Tab>Details</Tab>
                            <Tab>Evaluations {errors()}</Tab>
                        </TabList>

                        <TabPanels>
                            <TabPanel>
                                <TraceSummary traceId={props.traceId ?? ""} />
                                <SpanTree traceId={props.traceId ?? ""} />
                            </TabPanel>
                            <TabPanel>
                                <Evaluations
                                    traceId={props.traceId ?? ""}
                                    traceChecks={props.traceChecksQuery.data}
                                />
                            </TabPanel>
                        </TabPanels>
                    </Tabs>
                </DrawerBody>
            </DrawerContent>
        </Drawer>
    )
}