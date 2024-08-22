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
import { useCallback, useEffect } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import slugify from "slugify";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { HorizontalFormControl } from "./HorizontalFormControl";
import type {
  DatasetColumnType,
  DatasetRecordForm,
} from "../server/datasets/types";
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
  } = useForm<
    DatasetRecordForm & {
      schema: "ONE_MESSAGE_PER_ROW" | "ONE_LLM_CALL_PER_ROW";
    }
  >({
    defaultValues: {
      name: "",
      schema: "ONE_MESSAGE_PER_ROW",
      columnTypes: {
        input: "string",
        expected_output: "string",
      },
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
  const columnTypes = watch("columnTypes");

  useEffect(() => {
    if (currentSchema === "ONE_LLM_CALL_PER_ROW") {
      setValue("columnTypes", {
        llm_input: "chat_messages",
        expected_llm_output: "chat_messages",
      });
    } else {
      setValue("columnTypes", {
        input: "string",
        expected_output: "string",
      });
    }
  }, [currentSchema, setValue]);

  const onSubmit = (data: DatasetRecordForm) => {
    createDataset.mutate(
      {
        projectId: project?.id ?? "",
        name: data.name,
        columnTypes: data.columnTypes,
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

  const setColumn = useCallback(
    (columnName: string, columnType: DatasetColumnType) =>
      (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.checked) {
          setValue("columnTypes", {
            ...columnTypes,
            [columnName]: columnType,
          });
        } else {
          const columnTypes_ = { ...columnTypes };
          if (columnTypes_?.[columnName]) {
            delete columnTypes_[columnName];
          }
          setValue("columnTypes", columnTypes_);
        }
      },
    [setValue, columnTypes]
  );

  const AnnotationScores = () => {
    return (
      <Checkbox
        value="annotation_scores"
        onChange={setColumn("annotation_scores", "annotations")}
        isChecked={"annotation_scores" in columnTypes}
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
        onChange={setColumn("evaluations", "evaluations")}
        isChecked={"evaluations" in columnTypes}
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
              <RadioGroup defaultValue="ONE_MESSAGE_PER_ROW">
                <VStack spacing={4}>
                  <VStack align="start">
                    <Radio
                      size="md"
                      value="ONE_MESSAGE_PER_ROW"
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
                      value="ONE_LLM_CALL_PER_ROW"
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
              isInvalid={!!errors.columnTypes}
            >
              <VStack align="start">
                {currentSchema === "ONE_MESSAGE_PER_ROW" && (
                  <CheckboxGroup defaultValue={["input", "expected_output"]}>
                    <Checkbox
                      value="input"
                      onChange={setColumn("input", "string")}
                      isChecked={"input" in columnTypes}
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
                      onChange={setColumn("expected_output", "string")}
                      isChecked={"expected_output" in columnTypes}
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
                      onChange={setColumn("contexts", "rag_contexts")}
                      isChecked={"contexts" in columnTypes}
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
                      onChange={setColumn("spans", "spans")}
                      isChecked={"spans" in columnTypes}
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
                      onChange={setColumn("comments", "string")}
                      isChecked={"comments" in columnTypes}
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

                {currentSchema === "ONE_LLM_CALL_PER_ROW" && (
                  <CheckboxGroup
                    defaultValue={["llm_input", "expected_llm_output"]}
                  >
                    <Checkbox
                      value="llm_input"
                      onChange={setColumn("llm_input", "chat_messages")}
                      isChecked={"llm_input" in columnTypes}
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
                      onChange={setColumn(
                        "expected_llm_output",
                        "chat_messages"
                      )}
                      isChecked={"expected_llm_output" in columnTypes}
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
                      onChange={setColumn("comments", "string")}
                      isChecked={"comments" in columnTypes}
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
