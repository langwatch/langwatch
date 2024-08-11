import {
  Button,
  Checkbox,
  CheckboxGroup,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  FormErrorMessage,
  FormHelperText,
  HStack,
  Input,
  Radio,
  RadioGroup,
  Text,
  VStack,
  useToast,
} from "@chakra-ui/react";
import { DatabaseSchema } from "@prisma/client";
import { useEffect } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import slugify from "slugify";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { HorizontalFormControl } from "./HorizontalFormControl";
import type { DatasetRecordForm } from "../server/datasets/types";
import { datasetRecordFormSchema } from "../server/datasets/types.generated";
import { zodResolver } from "@hookform/resolvers/zod";

interface AddDatasetDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (datasetId: string) => void;
}

export const AddDatasetDrawer = (props: AddDatasetDrawerProps) => {
  const { project } = useOrganizationTeamProject();
  const toast = useToast();
  const createDataset = api.dataset.create.useMutation();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    reset,
    setValue,
  } = useForm<DatasetRecordForm>({
    defaultValues: {
      name: "",
      schema: DatabaseSchema.ONE_MESSAGE_PER_ROW,
      columns: ["input", "expected_output"],
    },
    resolver: async (data, context, options) => {
      const result = await zodResolver(datasetRecordFormSchema)(
        data,
        context,
        options
      );

      if (!data.name || data.name.trim() === "") {
        (result.errors as FieldErrors<DatasetRecordForm>).name = {
          type: "required",
          message: "Name is required",
        };
      }
      return result;
    },
  });

  const currentSchema = watch("schema");

  const name = watch("name");
  const slug = slugify(name || "", { lower: true, strict: true });

  useEffect(() => {
    if (currentSchema === DatabaseSchema.ONE_LLM_CALL_PER_ROW) {
      setValue("columns", ["llm_input", "expected_llm_output"]);
    } else {
      setValue("columns", ["input", "expected_output"]);
    }
  }, [currentSchema, setValue]);

  const onSubmit = (data: DatasetRecordForm) => {
    createDataset.mutate(
      {
        projectId: project?.id ?? "",
        name: data.name,
        schema: data.schema,
        columns: data.columns,
      } as DatasetRecordForm & { projectId: string },
      {
        onSuccess: (data) => {
          props.onSuccess(data.id);
          toast({
            title: "Dataset Created",
            description: `Successfully created ${data.name} dataset`,
            status: "success",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
          reset();
        },
        onError: (error) => {
          toast({
            title: "Error creating dataset",
            description: error.message,
            status: "error",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
        },
      }
    );
  };

  const AnnotationScores = () => {
    return (
      <Checkbox
        value="annotation_scores"
        {...register("columns")}
        alignItems="start"
        paddingTop={2}
      >
        <VStack align="start" marginTop={-1}>
          <HStack>
            <Text fontWeight="500">Annotation Scores</Text>
            <Text fontSize={13} color="gray.500">
              (optional)
            </Text>
          </HStack>
          <Text fontSize={13}>
            A JSON with all the scores for the annotations on the given trace.
          </Text>
        </VStack>
      </Checkbox>
    );
  };

  const Evaluations = () => {
    return (
      <Checkbox
        value="evaluations"
        {...register("columns")}
        alignItems="start"
        paddingTop={2}
      >
        <VStack align="start" marginTop={-1}>
          <HStack>
            <Text fontWeight="500">Evaluations</Text>
            <Text fontSize={13} color="gray.500">
              (optional)
            </Text>
          </HStack>
          <Text fontSize={13}>
            A JSON with all the evaluations for the given trace.
          </Text>
        </VStack>
      </Checkbox>
    );
  };

  return (
    <Drawer
      isOpen={props.isOpen}
      placement="right"
      size={"xl"}
      onClose={props.onClose}
    >
      <DrawerContent>
        <DrawerHeader>
          <HStack>
            <DrawerCloseButton />
          </HStack>
          <HStack>
            <Text paddingTop={5} fontSize="2xl">
              New Dataset
            </Text>
          </HStack>
        </DrawerHeader>
        <DrawerBody>
          {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
          <form onSubmit={handleSubmit(onSubmit)}>
            <HorizontalFormControl
              label="Name"
              helper="Give it a name that identifies what this group of examples is
              going to focus on"
              isInvalid={!!errors.name}
            >
              <Input
                placeholder="Good Responses Dataset"
                {...register("name")}
              />
              {slug && <FormHelperText>slug: {slug}</FormHelperText>}
              <FormErrorMessage>{errors.name?.message}</FormErrorMessage>
            </HorizontalFormControl>

            <HorizontalFormControl
              label="Schema"
              helper="Define the type of structure for this dataset"
              isInvalid={!!errors.schema}
              minWidth="calc(50% - 16px)"
            >
              <RadioGroup defaultValue={DatabaseSchema.ONE_MESSAGE_PER_ROW}>
                <VStack spacing={4}>
                  <VStack align="start">
                    <Radio
                      size="md"
                      value={DatabaseSchema.ONE_MESSAGE_PER_ROW}
                      colorScheme="blue"
                      alignItems="start"
                      spacing={3}
                      paddingTop={2}
                      {...register("schema")}
                    >
                      <VStack align="start" marginTop={-1}>
                        <Text fontWeight="500">One Message Per Row</Text>
                        <Text fontSize={13}>
                          This is the most common type of dataset for doing
                          batch evaluations and fine-tuning your model
                        </Text>
                      </VStack>
                    </Radio>
                  </VStack>
                  <VStack align="start">
                    <Radio
                      size="md"
                      value={DatabaseSchema.ONE_LLM_CALL_PER_ROW}
                      colorScheme="blue"
                      alignItems="start"
                      spacing={3}
                      paddingTop={2}
                      {...register("schema")}
                    >
                      <VStack align="start" marginTop={-1}>
                        <Text fontWeight="500">One LLM Call Per Row</Text>
                        <Text fontSize={13}>
                          Each entry will be a single LLM Call within a message,
                          this allows you to focus on improving on a single step
                          of your pipeline with both the playground and manual
                          runs
                        </Text>
                      </VStack>
                    </Radio>
                  </VStack>
                </VStack>
              </RadioGroup>
            </HorizontalFormControl>

            <HorizontalFormControl
              label="Columns"
              helper="Which columns should be present in the dataset"
              isInvalid={!!errors.columns}
            >
              <VStack align="start">
                {currentSchema === DatabaseSchema.ONE_MESSAGE_PER_ROW && (
                  <CheckboxGroup defaultValue={["input", "expected_output"]}>
                    <Checkbox
                      value="input"
                      {...register("columns")}
                      alignItems="start"
                      paddingTop={2}
                      readOnly
                    >
                      <VStack align="start" marginTop={-1}>
                        <HStack>
                          <Text fontWeight="500">Input</Text>
                          <Text fontSize={13} color="gray.500">
                            (required)
                          </Text>
                        </HStack>
                        <Text fontSize={13}>The message input string</Text>
                      </VStack>
                    </Checkbox>
                    <Checkbox
                      value="expected_output"
                      {...register("columns")}
                      alignItems="start"
                      paddingTop={2}
                      readOnly
                    >
                      <VStack align="start" marginTop={-1}>
                        <HStack>
                          <Text fontWeight="500">Expected Output</Text>
                          <Text fontSize={13} color="gray.500">
                            (required)
                          </Text>
                        </HStack>
                        <Text fontSize={13}>
                          The gold-standard expected output for the given input,
                          useful for output-comparison metrics
                        </Text>
                      </VStack>
                    </Checkbox>
                    <Checkbox
                      value="contexts"
                      {...register("columns")}
                      alignItems="start"
                      paddingTop={2}
                    >
                      <VStack align="start" marginTop={-1}>
                        <Text fontWeight="500">Contexts</Text>
                        <Text fontSize={13}>
                          The contexts provided if your are doing RAG, useful
                          for RAG-metric evaluations
                        </Text>
                      </VStack>
                    </Checkbox>
                    <Checkbox
                      value="spans"
                      {...register("columns")}
                      alignItems="start"
                      paddingTop={2}
                    >
                      <VStack align="start" marginTop={-1}>
                        <Text fontWeight="500">Spans</Text>
                        <Text fontSize={13}>
                          A JSON with all the spans contained in the message
                          trace, that is, all the steps in your pipeline, for
                          more complex evaluations
                        </Text>
                      </VStack>
                    </Checkbox>

                    <AnnotationScores />
                    <Evaluations />
                    <Checkbox
                      value="comments"
                      {...register("columns")}
                      alignItems="start"
                      paddingTop={2}
                    >
                      <VStack align="start" marginTop={-1}>
                        <HStack>
                          <Text fontWeight="500">Comments</Text>
                          <Text fontSize={13} color="gray.500">
                            (optional)
                          </Text>
                        </HStack>
                        <Text fontSize={13}>
                          A comment field for annotating the data in the given
                          row.
                        </Text>
                      </VStack>
                    </Checkbox>
                  </CheckboxGroup>
                )}

                {currentSchema === DatabaseSchema.ONE_LLM_CALL_PER_ROW && (
                  <CheckboxGroup
                    defaultValue={["llm_input", "expected_llm_output"]}
                  >
                    <Checkbox
                      value="llm_input"
                      {...register("columns")}
                      alignItems="start"
                      paddingTop={2}
                      readOnly
                    >
                      <VStack align="start" marginTop={-1}>
                        <HStack>
                          <Text fontWeight="500">LLM Input</Text>
                          <Text fontSize={13} color="gray.500">
                            (required)
                          </Text>
                        </HStack>
                        <Text fontSize={13}>
                          The input the LLM received, in LLM chat history json
                          format
                        </Text>
                      </VStack>
                    </Checkbox>
                    <Checkbox
                      value="expected_llm_output"
                      {...register("columns")}
                      alignItems="start"
                      paddingTop={2}
                      readOnly
                    >
                      <VStack align="start" marginTop={-1}>
                        <HStack>
                          <Text fontWeight="500">Expected LLM Output</Text>
                          <Text fontSize={13} color="gray.500">
                            (required)
                          </Text>
                        </HStack>
                        <Text fontSize={13}>
                          The gold-standard expected output for the given input,
                          in LLM chat history json format
                        </Text>
                      </VStack>
                    </Checkbox>

                    <AnnotationScores />
                    <Evaluations />
                    <Checkbox
                      value="comments"
                      {...register("columns")}
                      alignItems="start"
                      paddingTop={2}
                    >
                      <VStack align="start" marginTop={-1}>
                        <HStack>
                          <Text fontWeight="500">Comments</Text>
                          <Text fontSize={13} color="gray.500">
                            (optional)
                          </Text>
                        </HStack>
                        <Text fontSize={13}>
                          A comment field for annotating the data in the given
                          row.
                        </Text>
                      </VStack>
                    </Checkbox>
                  </CheckboxGroup>
                )}
              </VStack>
            </HorizontalFormControl>
            <Button
              colorScheme="blue"
              type="submit"
              minWidth="fit-content"
              isLoading={createDataset.isLoading}
            >
              Create Dataset
            </Button>
          </form>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
};
