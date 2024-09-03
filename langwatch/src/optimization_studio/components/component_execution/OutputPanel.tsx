import {
  Box,
  Heading,
  HStack,
  Spacer,
  Text,
  VStack,
  type BoxProps,
} from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { RenderInputOutput } from "../../../components/traces/RenderInputOutput";
import { SpanDuration } from "../../../components/traces/SpanDetails";
import type { Component } from "../../types/dsl";
import { useDebounceValue } from "usehooks-ts";

export const OutputPanel = ({ node }: { node: Node<Component> }) => {
  const [isWaitingLong] = useDebounceValue(
    node?.data.execution_state?.status === "waiting",
    600
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
    >
      <VStack align="start" spacing={3}>
        <HStack align="start" width="full">
          <Heading
            as="h3"
            fontSize={16}
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
            node.data.execution_state?.status === "error") ? (
            <SpanDuration
              span={{
                error: node.data.execution_state.error,
                timestamps: {
                  started_at:
                    node.data.execution_state.timestamps.started_at ?? 0,
                  finished_at:
                    node.data.execution_state.timestamps.finished_at ?? 0,
                },
              }}
            />
          ) : null}
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
              <VStack width="full" align="start" spacing={3}>
                <Text
                  fontSize={13}
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
              Object.entries(node.data.execution_state.outputs).map(
                ([identifier, value]) => (
                  <VStack
                    width="full"
                    align="start"
                    key={identifier}
                    spacing={3}
                  >
                    <Text
                      fontSize={13}
                      fontWeight="bold"
                      textTransform="uppercase"
                      color="gray.600"
                    >
                      {identifier}
                    </Text>
                    <OutputBox value={value} />
                  </VStack>
                )
              )}
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
      <RenderInputOutput value={value} />
    </Box>
  );
};
