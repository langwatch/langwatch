import {
  Box,
  Button,
  FormErrorMessage,
  Heading,
  HStack,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";
import { Play } from "react-feather";
import { useForm, type FieldError } from "react-hook-form";
import { HorizontalFormControl } from "../../../components/HorizontalFormControl";
import {
  getInputsForExecution,
  useComponentExecution,
} from "../../hooks/useComponentExecution";
import type { Component } from "../../types/dsl";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";

export const InputPanel = ({ node }: { node: Node<Component> }) => {
  console.log("node", node);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Record<string, string>>({
    defaultValues: Object.fromEntries(
      Object.entries(getInputsForExecution({ node }).inputs).map(
        ([key, value]) => [
          key,
          typeof value === "object" ? JSON.stringify(value) : value ?? "",
        ]
      )
    ),
    resolver: (values) => {
      const { missingFields } = getInputsForExecution({ node, inputs: values });

      const response: {
        values: Record<string, string>;
        errors: Record<string, FieldError>;
      } = {
        values,
        errors: {},
      };
      for (const missingField of missingFields) {
        response.errors[missingField.identifier] = {
          type: "required",
          message: "This field is required",
        };
      }

      return response;
    },
  });

  const { triggerValidation, setTriggerValidation } = useWorkflowStore(
    (state) => ({
      triggerValidation: state.triggerValidation,
      setTriggerValidation: state.setTriggerValidation,
    })
  );

  const { startComponentExecution } = useComponentExecution();

  const onSubmit = useCallback(
    (data: Record<string, string>) => {
      console.log(data);
      console.log(node);
      startComponentExecution({ node, inputs: data });
    },
    [node, startComponentExecution]
  );

  const [animationFinished, setAnimationFinished] = useState(false);

  useEffect(() => {
    setTimeout(() => {
      setAnimationFinished(true);
    }, 700);
  }, []);

  useEffect(() => {
    if (triggerValidation) {
      setTimeout(
        () => {
          void handleSubmit(onSubmit)();
        },
        animationFinished ? 0 : 700
      );
      setTriggerValidation(false);
    }
  }, [
    animationFinished,
    handleSubmit,
    node,
    onSubmit,
    setTriggerValidation,
    triggerValidation,
  ]);

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
      overflowY="auto"
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
              helper={""}
              isInvalid={!!errors[input.identifier]}
            >
              <Textarea {...register(input.identifier)} />
              <FormErrorMessage>
                {errors[input.identifier]?.message}
              </FormErrorMessage>
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
