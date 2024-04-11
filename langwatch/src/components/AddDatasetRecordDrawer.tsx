import {
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@chakra-ui/icons";
import {
  Box,
  Button,
  Container,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  Flex,
  FormControl,
  FormErrorMessage,
  HStack,
  Link,
  Select,
  Spacer,
  Stack,
  Text,
  Textarea,
  Tooltip,
  VStack,
  useDisclosure,
  useToast,
} from "@chakra-ui/react";
import { DatabaseSchema } from "@prisma/client";
import { useEffect, useState } from "react";
import { HelpCircle } from "react-feather";
import { z } from "zod";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  chatMessageSchema,
  datasetSpanSchema,
} from "~/server/tracer/types.generated";
import { api } from "~/utils/api";
import { displayName } from "~/utils/datasets";
import { AddDatasetDrawer } from "./AddDatasetDrawer";

function formatNumberWithSuffix(number: number) {
  const suffixes = ["th", "st", "nd", "rd"];
  const lastDigit = number % 10;
  const suffix = suffixes[lastDigit <= 3 ? lastDigit : 0];

  return `${number}${suffix}`;
}

interface AddDatasetDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  traceId?: string;
  selectedTraceIds?: string[];
}

export function AddDatasetRecordDrawer(props: AddDatasetDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const [datasetId, setDatasetId] = useState<string>("");
  const [inputSpan, setInputSpan] = useState<any>();
  const [outputSpan, setOutputSpan] = useState<any>();
  const [spanTrace, setSpanTrace] = useState<any>("");
  const [inputError, setInputError] = useState<boolean>(false);
  const [outputError, setOutputError] = useState<boolean>(false);
  const [spanError, setSpanError] = useState<boolean>(false);
  const [databaseSchema, setDatabaseSchema] = useState<string>("");
  const [databaseSchemaName, setDatabaseSchemaName] = useState<string>("");
  const [selectedLLMCall, setSelectedLLMCall] = useState<any>();
  const [selectedTraceIds, setSelectedTraceIds] = useState<string[]>(
    props.selectedTraceIds ?? []
  );

  useEffect(() => {
    setSelectedTraceIds(props.selectedTraceIds ?? []);
  }, [props.selectedTraceIds]);

  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const selectIndexUp = () => {
    setSelectedIndex(selectedIndex + 1);
  };

  const selectIndexDown = () => {
    setSelectedIndex(selectedIndex - 1);
  };

  const { onOpen, onClose, isOpen } = useDisclosure();

  const tracesWithSpans = api.traces.getTracesWithSpans.useQuery({
    projectId: project?.id ?? "",
    traceIds: props?.selectedTraceIds ?? [props?.traceId ?? ""],
  });

  const toast = useToast();
  const createDatasetRecord = api.datasetRecord.create.useMutation();

  const datasets = api.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project,
    }
  );

  const onCreateDatasetSuccess = () => {
    onClose();
    void datasets.refetch();
  };

  const handleOnClose = () => {
    props.onClose();
    setInputSpan("");
    setOutputSpan("");
    setDatasetId("");
    setSpanTrace("");
    setOutputError(false);
    setInputError(false);
    setDatabaseSchema("");
  };

  const inputCheck = (inputValue: any) => {
    if (databaseSchema === DatabaseSchema.LLM_CHAT_CALL) {
      try {
        JSON.parse(inputValue);
        const inputTypeCheck = z.array(chatMessageSchema);
        const result = inputTypeCheck.safeParse(JSON.parse(inputValue));
        return result;
      } catch (e) {
        return false;
      }
    } else if (
      databaseSchema === DatabaseSchema.FULL_TRACE ||
      databaseSchema === DatabaseSchema.STRING_I_O
    ) {
      const inputTypeCheck = z.string();
      const result = inputTypeCheck.safeParse(inputValue);
      return result;
    }
  };

  const outputCheck = (outputValue: any) => {
    if (databaseSchema === DatabaseSchema.LLM_CHAT_CALL) {
      try {
        JSON.parse(outputValue);
        const outputTypeCheck = z.array(chatMessageSchema);
        const result = outputTypeCheck.safeParse(JSON.parse(outputValue));
        return result;
      } catch (e) {
        return false;
      }
    } else if (
      databaseSchema === DatabaseSchema.FULL_TRACE ||
      databaseSchema === DatabaseSchema.STRING_I_O
    ) {
      const outputTypeCheck = z.string();
      const result = outputTypeCheck.safeParse(outputValue);
      return result;
    }
  };

  const spanCheck = (spanValue: any) => {
    try {
      const spanTypeCheck = z.array(datasetSpanSchema);
      const result = spanTypeCheck.safeParse(JSON.parse(spanValue));
      return result;
    } catch (e) {
      return false;
    }
  };

  const onSubmit = (e: any) => {
    e.preventDefault();

    if (inputError || outputError || spanError) {
      return;
    }

    const entries = Object.keys(inputSpan).map((key) => {
      if (databaseSchema === DatabaseSchema.STRING_I_O) {
        return {
          input: inputSpan[key],
          output: outputSpan[key],
        };
      } else if (databaseSchema === DatabaseSchema.FULL_TRACE) {
        return {
          input: inputSpan[key],
          output: outputSpan[key],
          spans: JSON.parse(spanTrace[key]),
        };
      } else if (databaseSchema === DatabaseSchema.LLM_CHAT_CALL) {
        return {
          input: JSON.parse(inputSpan[key]),
          output: JSON.parse(outputSpan[key]),
        };
      }
    });

    createDatasetRecord.mutate(
      {
        projectId: project?.id ?? "",

        entries: entries,
        datasetId: datasetId,
        datasetSchema: databaseSchema,
      },
      {
        onSuccess: () => {
          props.onClose();
          toast({
            duration: 3000,
            position: "top-right",
            render: () => (
              <Box
                p={5}
                paddingRight={20}
                bg="green.200"
                borderTop={"green.600"}
                borderTopWidth={2}
              >
                <HStack>
                  <CheckCircleIcon w={18} h={18} color={"green.600"} />
                  <Box>
                    <Text color={"black"} fontWeight={"bold"}>
                      Succesfully added to dataset
                    </Text>
                    <Link
                      color={"black"}
                      textDecoration={"underline"}
                      href={`/${project?.slug}/datasets/${datasetId}`}
                    >
                      View the dataset
                    </Link>
                  </Box>
                </HStack>
              </Box>
            ),
          });
        },
        onError: () => {
          toast({
            title: "Failed to upload dataset",
            description:
              "Please make sure you have edited the input and output fields correctly",
            status: "error",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
        },
      }
    );
  };

  const selectLLMCall = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    const callSelected = value !== "" ? parseInt(value) : "";
    const existingLLMCall = { ...selectedLLMCall };
    existingLLMCall[selectedIndex] = value;
    setSelectedLLMCall(existingLLMCall);

    if (
      databaseSchema === DatabaseSchema.LLM_CHAT_CALL &&
      callSelected !== ""
    ) {
      const existingInputSpan = { ...inputSpan };
      existingInputSpan[selectedIndex] = JSON.stringify(
        JSON.parse(
          tracesWithSpans.data?.[selectedIndex]?.spans?.[callSelected]?.input
            ?.value ?? ""
        ),
        undefined,
        2
      );
      setInputSpan(existingInputSpan);

      const existingOutputSpan = { ...outputSpan };
      existingOutputSpan[selectedIndex] = JSON.stringify(
        JSON.parse(
          tracesWithSpans.data?.[selectedIndex]?.spans?.[callSelected]
            ?.outputs?.[0]?.value ?? ""
        ),
        undefined,
        2
      );
      setOutputSpan(existingOutputSpan);
    } else {
      inputSpan[selectedIndex] = "";
      outputSpan[selectedIndex] = "";
      setInputSpan(inputSpan);
      setOutputSpan(outputSpan);
    }
  };

  const handleSpansChange = (e: any) => {
    const spans = e.target.value;
    const updatedSpanTrace = { ...spanTrace };
    updatedSpanTrace[selectedIndex] = spans;
    setSpanTrace(updatedSpanTrace);

    const spanResult = spanCheck(spans);
    if (spanResult && spanResult.success) {
      setSpanError(false);
    } else {
      setSpanError(true);
    }
  };

  const handleInputChange = (e: any) => {
    const inputValue = e.target.value;

    const updatedInputSpan = { ...inputSpan };
    updatedInputSpan[selectedIndex] = inputValue;
    setInputSpan(updatedInputSpan);
    const inputResult = inputCheck(inputValue);

    if (inputResult && inputResult.success) {
      setInputError(false);
    } else {
      setInputError(true);
    }
  };

  const handleOutputChange = (e: any) => {
    const outputValue = e.target.value;

    const updatedOutputSpan = { ...outputSpan };
    updatedOutputSpan[selectedIndex] = outputValue;

    setOutputSpan(updatedOutputSpan);
    const outputResult = outputCheck(outputValue);

    if (outputResult && outputResult.success) {
      setOutputError(false);
    } else {
      setOutputError(true);
    }
  };

  const createFullTraceDataset = (spans: any) => {
    if (spans) {
      const newArray = JSON.parse(JSON.stringify(spans));
      for (let i = 0; i < spans.length; i++) {
        const outputObj = JSON.parse(newArray[i].outputs[0].value);
        const inputObj = JSON.parse(newArray[i].input.value);
        newArray[i].outputs[0].value = outputObj;
        newArray[i].input.value = inputObj;
      }
      return JSON.stringify(newArray, null, 3);
    }
    return;
  };

  const handleDatasetChange = (e: any) => {
    const datasetSchema = datasets.data?.find(
      (dataset) => dataset.id === e.target.value
    )?.schema;

    const length = props.selectedTraceIds?.length ?? 0;
    const generateInitialObject = (length: number) => {
      return Object.fromEntries(Array.from({ length }, (_, i) => [i, ""]));
    };

    const initialInputSpans = generateInitialObject(length);
    const initialOutputSpans = generateInitialObject(length);
    const initialLLMCalls = generateInitialObject(length);
    const initialSpans = generateInitialObject(length);

    if (datasetSchema === DatabaseSchema.STRING_I_O) {
      tracesWithSpans.data?.forEach((trace, index) => {
        initialInputSpans[index] = trace.input.value ?? "";
        initialOutputSpans[index] = trace.output?.value ?? "";

        setInputSpan(initialInputSpans);
        setOutputSpan(initialOutputSpans);
      });
    }

    if (datasetSchema === DatabaseSchema.LLM_CHAT_CALL) {
      tracesWithSpans.data?.forEach((trace, index) => {
        initialInputSpans[index] = JSON.stringify(
          JSON.parse(trace.spans?.[0]?.input?.value ?? ""),
          undefined,
          2
        );

        initialOutputSpans[index] = JSON.stringify(
          JSON.parse(trace.spans?.[0]?.outputs?.[0]?.value ?? ""),
          undefined,
          2
        );
        initialLLMCalls[index] = "0";

        setInputSpan(initialInputSpans);
        setOutputSpan(initialOutputSpans);
        setSelectedLLMCall(initialLLMCalls);
      });
    }

    if (datasetSchema === DatabaseSchema.FULL_TRACE) {
      tracesWithSpans.data?.forEach((trace, index) => {
        initialInputSpans[index] = trace.input.value ?? "";
        initialOutputSpans[index] = trace.output?.value ?? "";
        const allSpans = createFullTraceDataset(trace.spans ?? "");
        initialSpans[index] = allSpans ?? "";

        setInputSpan(initialInputSpans);
        setOutputSpan(initialOutputSpans);
        setSpanTrace(initialSpans);
      });
    }

    setSelectedIndex(0);

    setDatabaseSchema(datasetSchema ?? "");
    setDatabaseSchemaName(displayName(datasetSchema!));
    setDatasetId(e.target.value);
  };

  const getInputErroMessage = () => {
    if (databaseSchema === DatabaseSchema.LLM_CHAT_CALL) {
      return "Invalid LLM Chat message format";
    } else if (databaseSchema === DatabaseSchema.STRING_I_O) {
      return "Invalid String Input/Output format";
    } else if (databaseSchema === DatabaseSchema.FULL_TRACE) {
      return "Invalid Full Trace format";
    }
  };

  const getOutputErroMessage = () => {
    if (databaseSchema === DatabaseSchema.LLM_CHAT_CALL) {
      return "Invalid LLM Chat message format";
    } else if (databaseSchema === DatabaseSchema.STRING_I_O) {
      return "Invalid String Input/Output format";
    } else if (databaseSchema === DatabaseSchema.FULL_TRACE) {
      return "Invalid Full Trace format";
    }
  };

  return (
    <Drawer
      isOpen={props.isOpen}
      placement="right"
      size={"xl"}
      onClose={handleOnClose}
      blockScrollOnMount={false}
    >
      <DrawerContent>
        <DrawerHeader>
          <HStack>
            <DrawerCloseButton />
          </HStack>
          <HStack>
            <Text paddingTop={5} fontSize="3xl">
              Add to Dataset
            </Text>
          </HStack>
        </DrawerHeader>
        <DrawerBody overflow="scroll">
          <form onSubmit={onSubmit}>
            <Stack gap={8}>
              <HStack align={"start"} gap={8}>
                <Container padding={0}>
                  <VStack align={"start"} padding={0}>
                    <Text fontWeight={"bold"}> Dataset</Text>
                    <Text fontSize={"sm"}>
                      Add to an existing dataset or create a new one
                    </Text>
                  </VStack>
                </Container>
                <Container>
                  <VStack align={"start"}>
                    <FormControl>
                      <Select required onChange={handleDatasetChange}>
                        <option value={""}>Select Dataset</option>
                        {datasets.data
                          ? datasets.data?.map((dataset, index) => (
                              <option key={index} value={dataset.id}>
                                {dataset.name}
                              </option>
                            ))
                          : null}
                      </Select>
                      <Button
                        colorScheme="blue"
                        onClick={() => {
                          onOpen();
                        }}
                        minWidth="fit-content"
                        variant="link"
                        marginTop={2}
                        fontWeight={"normal"}
                      >
                        + Create New
                      </Button>
                    </FormControl>
                  </VStack>
                </Container>
              </HStack>
              {selectedTraceIds.length > 1 ? (
                <HStack align={"start"} gap={8}>
                  <Container padding={0}>
                    <Text fontWeight={"bold"}>Edit Entries</Text>
                  </Container>
                  <Container padding={0}>
                    <Flex>
                      <Spacer />
                      <HStack gap={4}>
                        {selectedIndex === 0 ? (
                          <ChevronLeftIcon color={"gray.400"} />
                        ) : (
                          <ChevronLeftIcon
                            onClick={selectIndexDown}
                            cursor={"pointer"}
                          />
                        )}
                        <Text fontWeight={"bold"}>{`${selectedIndex + 1}/${
                          selectedTraceIds.length
                        }`}</Text>
                        {selectedIndex === selectedTraceIds.length - 1 ? (
                          <ChevronRightIcon color={"gray.400"} />
                        ) : (
                          <ChevronRightIcon
                            onClick={selectIndexUp}
                            cursor={"pointer"}
                          />
                        )}
                      </HStack>
                    </Flex>
                  </Container>
                </HStack>
              ) : null}

              {databaseSchema === DatabaseSchema.LLM_CHAT_CALL ? (
                <HStack align={"start"} gap={8}>
                  <Container padding={0}>
                    <VStack align={"start"} padding={0}>
                      <Text fontWeight={"bold"}>LLM Call</Text>
                      <Text fontSize={"sm"}>
                        Select which LLM call to add to the dataset
                      </Text>
                    </VStack>
                  </Container>
                  <Container>
                    <VStack align={"start"}>
                      <Select onChange={selectLLMCall} required>
                        <option value={""}>Select LLM Call</option>
                        {tracesWithSpans
                          ? tracesWithSpans.data?.[selectedIndex]?.spans?.map(
                              (dataset, index) =>
                                dataset.type === "llm" && (
                                  <option
                                    key={index}
                                    value={index}
                                    selected={
                                      selectedLLMCall[selectedIndex] ===
                                      index.toString()
                                    }
                                  >
                                    {dataset.model ?? "(noname)"} -{" "}
                                    {formatNumberWithSuffix(index + 1)} LLM Call
                                  </option>
                                )
                            )
                          : null}
                      </Select>
                    </VStack>
                  </Container>
                </HStack>
              ) : null}

              <HStack align={"start"} gap={8}>
                {databaseSchema ? (
                  <Text
                    whiteSpace="nowrap"
                    bg="gray.200"
                    paddingX="2"
                    paddingY="1"
                    borderRadius="lg"
                    fontSize={12}
                  >
                    {databaseSchemaName}
                  </Text>
                ) : null}
              </HStack>

              {databaseSchema !== "" ? (
                <>
                  <FormControl isInvalid={inputError}>
                    <HStack marginBottom={2}>
                      <Text fontWeight={"bold"}> Input</Text>
                      <Tooltip label="Input by user">
                        <HelpCircle width="14px" />
                      </Tooltip>
                    </HStack>
                    <Textarea
                      onChange={handleInputChange}
                      rows={5}
                      value={inputSpan[selectedIndex]}
                    />
                    <FormErrorMessage>{getInputErroMessage()}</FormErrorMessage>
                  </FormControl>

                  <FormControl isInvalid={outputError}>
                    <HStack marginBottom={2}>
                      <Text fontWeight={"bold"}>Expected Output</Text>
                      <Tooltip label="Output generated by chat model">
                        <HelpCircle width="14px" />
                      </Tooltip>
                    </HStack>
                    <Textarea
                      onChange={handleOutputChange}
                      rows={5}
                      value={outputSpan[selectedIndex]}
                    />
                    <FormErrorMessage>
                      {getOutputErroMessage()}
                    </FormErrorMessage>
                  </FormControl>
                </>
              ) : null}

              {databaseSchema === DatabaseSchema.FULL_TRACE ? (
                <FormControl isInvalid={spanError}>
                  <HStack marginBottom={2}>
                    <Text fontWeight={"bold"}> Spans</Text>
                    <Tooltip label="Full span trace of all messages">
                      <HelpCircle width="14px" />
                    </Tooltip>
                  </HStack>
                  <Textarea
                    onChange={handleSpansChange}
                    rows={10}
                    value={spanTrace[selectedIndex]}
                  />
                  <FormErrorMessage>Invalid Span format</FormErrorMessage>
                </FormControl>
              ) : null}

              {databaseSchema == "" ? null : createDatasetRecord.isLoading ? (
                <Button colorScheme="blue" width="fit-content">
                  Uploading...
                </Button>
              ) : (
                <Button colorScheme="blue" type="submit" width="fit-content">
                  Add to dataset
                </Button>
              )}
            </Stack>
          </form>
        </DrawerBody>
      </DrawerContent>
      <AddDatasetDrawer
        isOpen={isOpen}
        onClose={onClose}
        onSuccess={onCreateDatasetSuccess}
      />
    </Drawer>
  );
}
