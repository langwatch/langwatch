import {
  Box,
  Button,
  Heading,
  HStack,
  Spacer,
  Text,
  VStack,
  type BoxProps,
} from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import numeral from "numeral";
import { useDebounceValue } from "usehooks-ts";
import { RenderInputOutput } from "../../../components/traces/RenderInputOutput";
import { SpanDuration } from "../../../components/traces/SpanDetails";
import type { Component } from "../../types/dsl";
import { useDrawer } from "../../../components/CurrentDrawer";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import { useShallow } from "zustand/react/shallow";

export const OutputPanel = ({ node }: { node: Node<Component> }) => {
  const [isWaitingLong] = useDebounceValue(
    node?.data.execution_state?.status === "waiting",
    600
  );

  const { openDrawer } = useDrawer();

  const { enableTracing } = useWorkflowStore(
    useShallow((state) => ({
      enableTracing: state.enable_tracing,
    }))
  );

  return (
    <Box
      background="white"
      height="full"
      padding={6}
      border="1px solid"
      borderColor="gray.350"
      borderRadius="0 8px 8px 0"
      borderLeftWidth={0}
      boxShadow="0 0 10px rgba(0,0,0,0.05)"
      overflowY="auto"
    >
      <VStack align="start" gap={3}>
        <HStack align="center" width="full" paddingBottom={3}>
          <Heading
            as="h3"
            fontSize="16px"
            fontWeight="bold"
            textTransform="uppercase"
            color="gray.600"
            paddingBottom={4}
          >
            Outputs
          </Heading>
          <Spacer />
          {node.data.execution_state?.timestamps &&
            (node.data.execution_state?.status === "success" ||
              node.data.execution_state?.status === "error") && (
              <HStack gap={3}>
                {node.data.execution_state.cost !== undefined && (
                  <Text color="gray.500">
                    {numeral(node.data.execution_state.cost).format(
                      "$0.00[000]a"
                    )}
                  </Text>
                )}
                {node.data.execution_state.timestamps.started_at &&
                node.data.execution_state.timestamps.finished_at ? (
                  <>
                    {node.data.execution_state.cost !== undefined && (
                      <Text color="gray.400">·</Text>
                    )}
                    <SpanDuration
                      span={{
                        error:
                          node.data.execution_state?.status === "error"
                            ? node.data.execution_state.error
                            : undefined,
                        timestamps: {
                          started_at:
                            node.data.execution_state.timestamps.started_at ??
                            0,
                          finished_at:
                            node.data.execution_state.timestamps.finished_at ??
                            0,
                        },
                      }}
                    />
                  </>
                ) : null}

                {enableTracing && (
                  <>
                    <Text color="gray.400">·</Text>
                    <Button
                      size="sm"
                      onClick={() => {
                        openDrawer("traceDetails", {
                          traceId: node.data.execution_state?.trace_id ?? "",
                        });
                      }}
                    >
                      Full Trace
                    </Button>
                  </>
                )}
              </HStack>
            )}
        </HStack>
        {node.data.execution_state ? (
          <>
            {isWaitingLong &&
            node.data.execution_state?.status === "waiting" ? (
              <Text>Waiting for runner</Text>
            ) : (!isWaitingLong &&
                node?.data.execution_state?.status === "waiting") ||
              node?.data.execution_state?.status === "running" ? (
              <Text>Running...</Text>
            ) : null}
            {node.data.execution_state.status === "error" && (
              <VStack width="full" align="start" gap={3}>
                <Text
                  fontSize="13px"
                  fontWeight="bold"
                  textTransform="uppercase"
                  color="gray.600"
                >
                  Error
                </Text>
                <OutputBox
                  color="red.700"
                  value={
                    node.data.execution_state.error ??
                    "No error message captured"
                  }
                />
              </VStack>
            )}
            {node.data.execution_state.status === "success" &&
              node.data.execution_state.outputs &&
              Object.entries(node.data.execution_state.outputs)
                .filter(([_, value]) => value !== null)
                .map(([identifier, value]) => {
                  const isFail =
                    (node.type === "evaluator" &&
                      identifier === "passed" &&
                      value === false) ||
                    (identifier === "status" && value === "error");
                  const isSkipped =
                    node.type === "evaluator" &&
                    identifier === "status" &&
                    value === "skipped";
                  const isSuccess =
                    node.type === "evaluator" &&
                    identifier === "passed" &&
                    value === true;

                  return (
                    <VStack
                      width="full"
                      align="start"
                      key={identifier}
                      gap={3}
                      color={
                        isSkipped
                          ? "yellow.600"
                          : isFail
                          ? "red.600"
                          : isSuccess
                          ? "green.600"
                          : undefined
                      }
                    >
                      <Text
                        fontSize="13px"
                        fontWeight="bold"
                        textTransform="uppercase"
                        color={
                          isSkipped
                            ? "yellow.600"
                            : isFail
                            ? "red.600"
                            : isSuccess
                            ? "green.600"
                            : "gray.600"
                        }
                      >
                        {identifier}
                      </Text>
                      <OutputBox value={value} />
                    </VStack>
                  );
                })}
          </>
        ) : (
          <Text color="gray.500">Waiting for execution</Text>
        )}
      </VStack>
    </Box>
  );
};

const OutputBox = ({ value, ...props }: { value: any } & BoxProps) => {
  return (
    <Box
      as="pre"
      borderRadius="6px"
      padding={4}
      borderWidth="1px"
      borderColor="gray.300"
      width="full"
      whiteSpace="pre-wrap"
      {...props}
    >
      <RenderInputOutput value={value} showTools />
    </Box>
  );
};
