import {
  Box,
  Button,
  Container,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  HStack,
  Input,
  Radio,
  RadioGroup,
  VStack,
  useToast,
  Text,
  CheckboxGroup,
  Checkbox,
} from "@chakra-ui/react";
import { DatabaseSchema } from "@prisma/client";
import { useForm } from "react-hook-form";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import slugify from "slugify";
import { HorizontalFormControl } from "./HorizontalFormControl";
import { SmallLabel } from "./SmallLabel";
import { useEffect } from "react";

interface AddDatasetDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface AddDatasetForm {
  dataSetName: string;
  schemaValue: DatabaseSchema;
  columns: (
    | "input"
    | "expected_output"
    | "contexts"
    | "spans"
    | "llm_input"
    | "expected_llm_output"
  )[];
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
    getValues,
    setValue,
  } = useForm<AddDatasetForm>({
    defaultValues: {
      dataSetName: "",
      schemaValue: DatabaseSchema.ONE_MESSAGE_PER_ROW,
      columns: ["input", "expected_output"],
    },
  });

  const defaultColumns = getValues("columns");
  const currentSchemaValue = watch("schemaValue");

  const dataSetName = watch("dataSetName");
  const slug = slugify(dataSetName || "", { lower: true, strict: true });

  useEffect(() => {
    if (currentSchemaValue === DatabaseSchema.ONE_LLM_CALL_PER_ROW) {
      setValue("columns", ["llm_input", "expected_llm_output"]);
    } else {
      setValue("columns", ["input", "expected_output"]);
    }
  }, [currentSchemaValue, setValue]);

  const onSubmit = (data: AddDatasetForm) => {
    console.log("data", data);
    // createDataset.mutate(
    //   {
    //     projectId: project?.id ?? "",
    //     name: data.dataSetName,
    //     schema: data.schemaValue,
    //   },
    //   {
    //     onSuccess: () => {
    //       props.onSuccess();
    //       toast({
    //         title: "Dataset Created",
    //         description: `You have successfully created the dataset ${data.dataSetName}`,
    //         status: "success",
    //         duration: 5000,
    //         isClosable: true,
    //         position: "top-right",
    //       });
    //       reset();
    //     },
    //     onError: (error) => {
    //       toast({
    //         title: "Error creating dataset",
    //         description: error.message,
    //         status: "error",
    //         duration: 5000,
    //         isClosable: true,
    //         position: "top-right",
    //       });
    //     },
    //   }
    // );
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
              isInvalid={!!errors.schemaValue}
            >
              <Input
                placeholder="Good Responses Dataset"
                {...register("dataSetName", {
                  required: "Dataset name is required",
                })}
              />
              {slug && <FormHelperText>slug: {slug}</FormHelperText>}
              <FormErrorMessage>{errors.dataSetName?.message}</FormErrorMessage>
            </HorizontalFormControl>

            <HorizontalFormControl
              label="Schema"
              helper="Define the type of structure for this dataset"
              isInvalid={!!errors.schemaValue}
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
                      {...register("schemaValue")}
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
                      {...register("schemaValue")}
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
                {currentSchemaValue === DatabaseSchema.ONE_MESSAGE_PER_ROW && (
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
                  </CheckboxGroup>
                )}

                {currentSchemaValue === DatabaseSchema.ONE_LLM_CALL_PER_ROW && (
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
                  </CheckboxGroup>
                )}
              </VStack>
            </HorizontalFormControl>
            <Button colorScheme="blue" type="submit" minWidth="fit-content">
              Create Dataset
            </Button>
          </form>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
};
