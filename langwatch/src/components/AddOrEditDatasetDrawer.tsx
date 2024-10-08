import {
  Box,
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
  Heading,
  Input,
  Radio,
  RadioGroup,
  Select,
  Text,
  VStack,
  useToast,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect } from "react";
import { Trash2 } from "react-feather";
import { useFieldArray, useForm, type FieldErrors } from "react-hook-form";
import slugify from "slugify";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import type {
  DatasetColumnType,
  DatasetColumns,
  DatasetRecordEntry,
  DatasetRecordForm,
} from "../server/datasets/types";
import { datasetRecordFormSchema } from "../server/datasets/types.generated";
import { api } from "../utils/api";
import { HorizontalFormControl } from "./HorizontalFormControl";
import type { InMemoryDataset } from "./datasets/DatasetTable";
import { DatasetPreview } from "./datasets/DatasetPreview";

interface AddDatasetDrawerProps {
  datasetToSave?: Omit<InMemoryDataset, "datasetRecords"> & {
    datasetId?: string;
    datasetRecords?: InMemoryDataset["datasetRecords"];
  };
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (dataset: {
    datasetId: string;
    name: string;
    columnTypes: DatasetColumns;
  }) => void;
}

type ColumnType = {
  name: string;
  type: DatasetColumnType;
};

type FormValues = {
  name: string;
  schema: "ONE_MESSAGE_PER_ROW" | "ONE_LLM_CALL_PER_ROW" | "CUSTOM";
  columnTypes: ColumnType[];
};

export const AddOrEditDatasetDrawer = (props: AddDatasetDrawerProps) => {
  const { project } = useOrganizationTeamProject();
  const toast = useToast();
  const upsertDataset = api.dataset.upsert.useMutation();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    reset,
    setValue,
    control,
  } = useForm<FormValues>({
    defaultValues: {
      name: props.datasetToSave?.name ?? "",
      schema: props.datasetToSave ? "CUSTOM" : "ONE_MESSAGE_PER_ROW",
      columnTypes: props.datasetToSave?.columnTypes ?? [
        { name: "input", type: "string" },
        { name: "expected_output", type: "string" },
      ],
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

      const columnNamesSet = new Set();
      for (const col of data.columnTypes) {
        if (col.name.trim() === "") {
          (result.errors as FieldErrors<DatasetRecordForm>).columnTypes = {
            type: "required",
            message: `Column name cannot be empty`,
          };
          break;
        }
        if (columnNamesSet.has(col.name)) {
          (result.errors as FieldErrors<DatasetRecordForm>).columnTypes = {
            type: "required",
            message: `Cannot have multiple columns with the same name: \`${col.name}\``,
          };
        }
        columnNamesSet.add(col.name);
      }
      return result;
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "columnTypes",
  });

  const name = watch("name");
  const slug = slugify((name || "").replace("_", "-"), {
    lower: true,
    strict: true,
  });
  const schemaField = register("schema");
  const currentSchema = watch("schema");
  const columnTypes = watch("columnTypes");

  useEffect(() => {
    if (props.datasetToSave) {
      setTimeout(() => {
        reset({
          name: props.datasetToSave!.name ?? "",
          schema: "CUSTOM",
          columnTypes: props.datasetToSave!.columnTypes,
        });
      }, 0);
    } else {
      reset({
        name: "",
        schema: "ONE_MESSAGE_PER_ROW",
        columnTypes: [
          { name: "input", type: "string" },
          { name: "expected_output", type: "string" },
        ],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!props.isOpen]);

  const setSchema = useCallback(
    (schema: "ONE_LLM_CALL_PER_ROW" | "ONE_MESSAGE_PER_ROW" | "CUSTOM") => {
      if (schema === "ONE_LLM_CALL_PER_ROW") {
        setValue("columnTypes", [
          { name: "llm_input", type: "chat_messages" },
          { name: "expected_llm_output", type: "chat_messages" },
        ]);
      } else if (schema === "ONE_MESSAGE_PER_ROW") {
        setValue("columnTypes", [
          { name: "input", type: "string" },
          { name: "expected_output", type: "string" },
        ]);
      } else if (schema === "CUSTOM") {
        setValue("columnTypes", [
          { name: "input", type: "string" },
          { name: "expected_output", type: "string" },
        ]);
      }
      setValue("schema", schema);
    },
    [setValue]
  );

  const onSubmit = (data: DatasetRecordForm) => {
    upsertDataset.mutate(
      {
        projectId: project?.id ?? "",
        datasetId: props.datasetToSave?.datasetId,
        name: data.name,
        columnTypes: data.columnTypes,
        ...(props.datasetToSave?.datasetRecords
          ? {
              datasetRecords: tryToConvertRowsToAppropriateType(
                props.datasetToSave.datasetRecords,
                data.columnTypes
              ),
            }
          : {}),
      },
      {
        onSuccess: (data) => {
          props.onSuccess({
            datasetId: data.id,
            name: data.name,
            columnTypes: data.columnTypes as DatasetColumns,
          });
          toast({
            title: props.datasetToSave?.datasetId
              ? "Dataset Updated"
              : props.datasetToSave
              ? "Dataset Saved"
              : "Dataset Created",
            description: props.datasetToSave?.datasetId
              ? `Successfully updated ${data.name} dataset`
              : `Successfully created ${data.name} dataset`,
            status: "success",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
          reset();
        },
        onError: (error) => {
          toast({
            title: props.datasetToSave?.datasetId
              ? "Error updating dataset"
              : "Error creating dataset",
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
        const currentColumnTypes = watch("columnTypes");
        if (e.target.checked) {
          append({ name: columnName, type: columnType });
        } else {
          const index = currentColumnTypes.findIndex(
            (col) => col.name === columnName
          );
          if (index !== -1) {
            remove(index);
          }
        }
      },
    [append, remove, watch]
  );

  const AnnotationScores = () => {
    return (
      <Checkbox
        value="annotation_scores"
        onChange={setColumn("annotation_scores", "annotations")}
        isChecked={columnTypes.some((col) => col.name === "annotation_scores")}
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
        isChecked={columnTypes.some((col) => col.name === "evaluations")}
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
              {props.datasetToSave?.datasetId
                ? "Edit Dataset"
                : props.datasetToSave
                ? "Save Dataset"
                : "New Dataset"}
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

            {!props.datasetToSave && (
              <HorizontalFormControl
                label="Schema"
                helper="Define the type of structure for this dataset"
                isInvalid={!!errors.schema}
                minWidth="calc(50% - 16px)"
              >
                <RadioGroup defaultValue="ONE_MESSAGE_PER_ROW">
                  <VStack align="start" spacing={4}>
                    <VStack align="start">
                      <Radio
                        size="md"
                        value="ONE_MESSAGE_PER_ROW"
                        colorScheme="blue"
                        alignItems="start"
                        spacing={3}
                        paddingTop={2}
                        {...schemaField}
                        onChange={() => setSchema("ONE_MESSAGE_PER_ROW")}
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
                        {...schemaField}
                        onChange={() => setSchema("ONE_LLM_CALL_PER_ROW")}
                      >
                        <VStack align="start" marginTop={-1}>
                          <Text fontWeight="500">One LLM Call Per Row</Text>
                          <Text fontSize={13}>
                            Each entry will be a single LLM Call within a
                            message, this allows you to focus on improving on a
                            single step of your pipeline with both the
                            playground and manual runs
                          </Text>
                        </VStack>
                      </Radio>
                    </VStack>
                    <VStack align="start">
                      <Radio
                        size="md"
                        value="CUSTOM"
                        colorScheme="blue"
                        alignItems="start"
                        spacing={3}
                        paddingTop={2}
                        {...schemaField}
                        onChange={() => setSchema("CUSTOM")}
                      >
                        <VStack align="start" marginTop={-1}>
                          <Text fontWeight="500">Custom</Text>
                          <Text fontSize={13}>
                            Define your own columns and types for the dataset
                          </Text>
                        </VStack>
                      </Radio>
                    </VStack>
                  </VStack>
                </RadioGroup>
              </HorizontalFormControl>
            )}

            <HorizontalFormControl
              label="Columns"
              helper="Which columns should be present in the dataset"
              isInvalid={!!errors.columnTypes}
            >
              <VStack align="start">
                {currentSchema === "CUSTOM" ? (
                  <VStack align="start" width="full">
                    {fields.map((field, index) => (
                      <HStack key={field.id} width="full">
                        <Input
                          {...register(`columnTypes.${index}.name`, {
                            required: "Column name cannot be empty",
                          })}
                          placeholder="Column name"
                        />
                        <Select {...register(`columnTypes.${index}.type`)}>
                          <option value="string">string</option>
                          <option value="number">number</option>
                          <option value="boolean">boolean</option>
                          <option value="date">date</option>
                          <option value="json">json</option>
                          <option value="chat_messages">ChatMessages</option>
                          <option value="rag_contexts">RAGContexts</option>
                          <option value="spans">Spans</option>
                          <option value="annotations">Annotations</option>
                          <option value="evaluations">Evaluations</option>
                        </Select>
                        <Button size="sm" onClick={() => remove(index)}>
                          <Trash2 size={32} />
                        </Button>
                      </HStack>
                    ))}
                    <FormErrorMessage>
                      {errors.columnTypes?.message}
                    </FormErrorMessage>
                    <Button
                      onClick={() => append({ name: "", type: "string" })}
                    >
                      Add Column
                    </Button>
                  </VStack>
                ) : currentSchema === "ONE_MESSAGE_PER_ROW" ? (
                  <CheckboxGroup value={columnTypes.map((col) => col.name)}>
                    <Checkbox
                      value="input"
                      onChange={setColumn("input", "string")}
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
                      isChecked={columnTypes.some(
                        (col) => col.name === "contexts"
                      )}
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
                      isChecked={columnTypes.some(
                        (col) => col.name === "spans"
                      )}
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
                      isChecked={columnTypes.some(
                        (col) => col.name === "comments"
                      )}
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
                ) : (
                  <CheckboxGroup value={columnTypes.map((col) => col.name)}>
                    <Checkbox
                      value="llm_input"
                      onChange={setColumn("llm_input", "chat_messages")}
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
                      isChecked={columnTypes.some(
                        (col) => col.name === "comments"
                      )}
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
            {props.datasetToSave?.datasetRecords && (
              <VStack align="start" spacing={4} paddingY={6}>
                <HStack>
                  <Heading size="md">Preview</Heading>
                  <Text size="13px" color="gray.500">
                    {props.datasetToSave.datasetRecords.length} rows,{" "}
                    {columnTypes.length} columns
                  </Text>
                </HStack>
                <Box width="100%" overflowX="scroll">
                  <Box width={`${Math.max(20 * columnTypes.length, 100)}%`}>
                    <DatasetPreview
                      rows={tryToConvertRowsToAppropriateType(
                        props.datasetToSave.datasetRecords.slice(0, 5),
                        columnTypes
                      )}
                      columns={columnTypes.slice(0, 50)}
                    />
                  </Box>
                </Box>
              </VStack>
            )}
            <Button
              colorScheme="blue"
              type="submit"
              minWidth="fit-content"
              isLoading={upsertDataset.isLoading}
            >
              {props.datasetToSave ? "Save" : "Create Dataset"}
            </Button>
          </form>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
};

export const tryToConvertRowsToAppropriateType = (
  datasetRecords: DatasetRecordEntry[],
  columnTypes: ColumnType[]
) => {
  const typeForColumn = Object.fromEntries(
    columnTypes.map((col) => [col.name, col.type])
  );
  return datasetRecords.map((record) => {
    const convertedRecord = { ...record };
    for (const [key, value] of Object.entries(record)) {
      const type = typeForColumn[key];
      if (type === "number") {
        if (!value) {
          convertedRecord[key] = null;
        } else if (!isNaN(value)) {
          convertedRecord[key] = parseFloat(value);
        }
      } else if (type === "boolean") {
        if (
          ["true", "1", "yes", "y", "on", "ok"].includes(
            (value ?? "").toLowerCase()
          )
        ) {
          convertedRecord[key] = true;
        } else if (
          [
            "false",
            "0",
            "null",
            "undefined",
            "nan",
            "inf",
            "no",
            "n",
            "off",
          ].includes((value ?? "").toLowerCase())
        ) {
          convertedRecord[key] = false;
        }
      } else if (type === "date") {
        const dateAttempt = new Date(value);
        if (dateAttempt.toString() !== "Invalid Date") {
          convertedRecord[key] = dateAttempt.toISOString().split("T")[0];
        }
      } else if (type !== "string") {
        try {
          convertedRecord[key] = JSON.parse(value);
        } catch {}
      }
    }
    return convertedRecord;
  });
};
