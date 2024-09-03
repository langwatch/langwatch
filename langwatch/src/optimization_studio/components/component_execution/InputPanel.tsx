import {
  Box,
  Button,
  Heading,
  HStack,
  Textarea,
  VStack
} from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useCallback } from "react";
import {
  Play
} from "react-feather";
import { useForm } from "react-hook-form";
import { HorizontalFormControl } from "../../../components/HorizontalFormControl";
import {
  getInputsForExecution,
  useComponentExecution,
} from "../../hooks/useComponentExecution";
import type { Component } from "../../types/dsl";

export const InputPanel = ({ node }: { node: Node<Component> }) => {
  const { register, handleSubmit } = useForm<Record<string, string>>({
    defaultValues: getInputsForExecution({
      node,
    }).inputs,
  });

  const { startComponentExecution } = useComponentExecution();

  const onSubmit = useCallback(
    (data: Record<string, string>) => {
      startComponentExecution({ node, inputs: data });
    },
    [node, startComponentExecution]
  );

  return (
    <Box
      background="white"
      height="full"
      padding={6}
      border="1px solid"
      borderColor="gray.350"
      borderRadius="8px 0 0 8px"
      borderRightWidth={0}
      boxShadow="0 0 10px rgba(0,0,0,0.05)"
    >
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={handleSubmit(onSubmit)}>
        <VStack align="start" spacing={3} width="full">
          <Heading
            as="h3"
            fontSize={16}
            fontWeight="bold"
            textTransform="uppercase"
            color="gray.600"
            paddingBottom={4}
          >
            Inputs
          </Heading>
          {node.data.inputs?.map((input) => (
            <HorizontalFormControl
              key={input.identifier}
              label={input.identifier}
              helper={input.description ?? ""}
            >
              <Textarea {...register(input.identifier)} />
            </HorizontalFormControl>
          ))}
          <HStack width="full" justify="end">
            <Button
              type="submit"
              colorScheme="green"
              rightIcon={<Play size={16} />}
            >
              Execute
            </Button>
          </HStack>
        </VStack>
      </form>
    </Box>
  );
};