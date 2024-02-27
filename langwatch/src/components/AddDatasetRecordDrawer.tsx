import { CheckCircleIcon } from "@chakra-ui/icons";
import { Box, Button, Container, Drawer, DrawerBody, DrawerCloseButton, DrawerContent, DrawerHeader, FormControl, FormErrorMessage, HStack, Link, Select, Stack, Text, Textarea, Tooltip, VStack, useDisclosure, useToast } from "@chakra-ui/react";
import { DatabaseSchema } from "@prisma/client";
import { useState } from "react";
import { HelpCircle } from "react-feather";
import { z } from "zod";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useTraceDetailsState } from "~/hooks/useTraceDetailsState";
import { chatMessageSchema, } from "~/server/tracer/types.generated";
import { api } from "~/utils/api";
import { displayName } from "~/utils/datasets";
import { AddDatasetDrawer } from "./AddDatasetDrawer";



function formatNumberWithSuffix(number: number) {
    const suffixes = ['th', 'st', 'nd', 'rd'];
    const lastDigit = number % 10;
    const suffix = suffixes[lastDigit <= 3 ? lastDigit : 0];

    return `${number}${suffix}`;
}

interface AddDatasetDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    traceId?: string;
}

export function AddDatasetRecordDrawer(props: AddDatasetDrawerProps) {

    const { project } = useOrganizationTeamProject();
    const [datasetId, setDatasetId] = useState<string>("");
    const [inputSpan, setInputSpan] = useState<any>("");
    const [outputSpan, setOutputSpan] = useState<any>("");
    const [spanTrace, setSpanTrace] = useState<any>("");
    const [inputError, setInputError] = useState<boolean>(false);
    const [outputError, setOutputError] = useState<boolean>(false);
    const [databaseSchema, setDatabaseSchema] = useState<string>("");
    const [databaseSchemaName, setDatabaseSchemaName] = useState<string>("");

    const { onOpen, onClose, isOpen } = useDisclosure()

    const { traceId, trace } = useTraceDetailsState(props?.traceId);

    const spans = api.spans.getAllForTrace.useQuery(
        { projectId: project?.id ?? "", traceId: traceId ?? "" },
        { enabled: !!project && !!traceId, refetchOnWindowFocus: false }
    );

    const toast = useToast();
    const createDatasetRecord = api.datasetRecord.create.useMutation();

    const datasets = api.dataset.getAll.useQuery({ projectId: project?.id ?? "" },
        {
            enabled: !!project,

        });

    const onCreateDatasetSuccess = () => {
        onClose();
        void datasets.refetch();
    }

    const handleOnClose = () => {
        props.onClose();
        setInputSpan("")
        setOutputSpan("")
        setDatasetId("")
        setSpanTrace("")
        setOutputError(false)
        setInputError(false)
        setDatabaseSchema("")
    }

    const inputCheck = () => {

        const inputTypeCheck = z.array(chatMessageSchema)
        const result = inputTypeCheck.safeParse(JSON.parse(inputSpan))

        return result;

    }

    const outputCheck = () => {
        const outputTypeCheck = z.array(chatMessageSchema)
        const result = outputTypeCheck.safeParse(JSON.parse(outputSpan))

        return result;
    }

    const onSubmit = (e: any) => {
        e.preventDefault()

        let input;
        let output;

        const inputResult = inputCheck();
        inputResult.success ? setInputError(false) : setInputError(true)

        const outputResult = outputCheck();
        outputResult.success ? setOutputError(false) : setOutputError(true)


        if (!inputResult.success || !outputResult.success) {
            return;
        }


        if (databaseSchema === DatabaseSchema.LLM_CHAT_CALL) {
            input = JSON.parse(inputSpan);
            output = JSON.parse(outputSpan);
        } else if (databaseSchema === DatabaseSchema.FULL_TRACE) {
            input = inputSpan;
            output = outputSpan;
        }


        createDatasetRecord.mutate({
            projectId: project?.id ?? "",
            input: input,
            output: output,
            datasetId: datasetId,
            datasetSchema: databaseSchema,
            spans: spanTrace ? JSON.parse(spanTrace) : []
        },
            {
                onSuccess: () => {
                    props.onClose();
                    toast({
                        duration: 6000,
                        position: "top-right",
                        render: () => (
                            <Box p={5} paddingRight={20} bg='green.200' borderTop={'green.600'} borderTopWidth={2}>
                                <HStack>
                                    <CheckCircleIcon w={18} h={18} color={"green.600"} />
                                    <Box>
                                        <Text color={'black'} fontWeight={'bold'}>Succesfully added to dataset</Text>
                                        <Link color={'black'} textDecoration={"underline"} href={`/${project?.slug}/datasets/${datasetId}`}>
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
                        description: "Please make sure you have edited the input and output fields correctly",
                        status: "error",
                        duration: 5000,
                        isClosable: true,
                        position: "top-right",
                    });
                }
            },

        )
    }


    const selectLLMCall = (e: React.ChangeEvent<HTMLSelectElement>) => {

        const value = e.target.value;
        const callSelected = value !== "" ? parseInt(value) : "";

        if (callSelected !== "") {
            setInputSpan(JSON.stringify(JSON.parse(spans.data?.[callSelected]?.input?.value ?? ""), undefined, 2))
            setOutputSpan(JSON.stringify(JSON.parse(spans.data?.[callSelected]?.outputs?.[0]?.value ?? ""), undefined, 2))
        } else {
            setInputSpan("")
            setOutputSpan("")
        }
    }

    const handleSpansChange = (e: any) => {
        setSpanTrace(e.target.value)
    }

    const handleInputChange = (e: any) => {

        const inputValue = e.target.value
        setInputSpan(inputValue)
        try {
            JSON.parse(inputValue);
            const inputResult = inputCheck();
            inputResult.success ? setInputError(false) : setInputError(true)
        } catch (e) {
            setInputError(true)
        }
    }

    const handleOutputChange = (e: any) => {

        const outputValue = e.target.value
        setOutputSpan(outputValue)
        try {
            JSON.parse(outputValue);
            const outputResult = outputCheck();
            outputResult.success ? setOutputError(false) : setOutputError(true)

        } catch (e) {
            setOutputError(true)
        }

    }

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
    }


    const handleDatasetChange = (e: any) => {

        const datasetSchema = datasets.data?.find(dataset => dataset.id === e.target.value)?.schema;
        setInputSpan("");
        setOutputSpan("");
        setSpanTrace("");

        if (datasetSchema === DatabaseSchema.FULL_TRACE) {

            const input = trace.data ? trace.data?.input?.value : "";
            const output = trace.data ? trace.data?.output?.value : "";
            const allSpans = createFullTraceDataset(spans.data)

            setInputSpan(input)
            setOutputSpan(output)
            setSpanTrace(allSpans)
        }

        setDatabaseSchema(datasetSchema ?? "")
        setDatabaseSchemaName(displayName(datasetSchema!))
        setDatasetId(e.target.value)
        selectFullTraceDataset();
    }

    return (
        <Drawer
            isOpen={props.isOpen}
            placement="right"
            size={'xl'}
            onClose={handleOnClose}
            blockScrollOnMount={false}
        >
            <DrawerContent >
                <DrawerHeader>
                    <HStack>
                        <DrawerCloseButton />
                    </HStack>
                    <HStack>
                        <Text paddingTop={5} fontSize='3xl'>Add to Dataset</Text>
                    </HStack>
                </DrawerHeader>
                <DrawerBody overflow='scroll'>
                    <form onSubmit={onSubmit}>
                        <Stack gap={8}>
                            <HStack align={'start'} gap={8}>
                                <Container padding={0}>
                                    <VStack align={'start'} padding={0}>
                                        <Text fontWeight={'bold'}> Dataset</Text>
                                        <Text fontSize={'sm'}>Add to an existing dataset or create a new one</Text>
                                    </VStack>
                                </Container>
                                <Container>
                                    <VStack align={'start'}>
                                        <FormControl>
                                            <Select required onChange={handleDatasetChange}>
                                                <option value={""}>Select Dataset</option>
                                                {
                                                    datasets.data ?
                                                        datasets.data?.map((dataset, index) => (
                                                            <option key={index} value={dataset.id}>{dataset.name}</option>
                                                        )) : null
                                                }
                                            </Select>
                                            <Button
                                                colorScheme="blue"
                                                onClick={() => {
                                                    onOpen();
                                                }}
                                                minWidth="fit-content"
                                                variant='link'
                                                marginTop={2}
                                                fontWeight={'normal'}
                                            >
                                                + Create New
                                            </Button>
                                        </FormControl>
                                    </VStack>
                                </Container>
                            </HStack>

                            {databaseSchema === DatabaseSchema.LLM_CHAT_CALL ?
                                <HStack align={'start'} gap={8}>
                                    <Container padding={0}>
                                        <VStack align={'start'} padding={0}>
                                            <Text fontWeight={'bold'}>LLM Call</Text>
                                            <Text fontSize={'sm'}>Select which LLM call to add to the dataset</Text>
                                        </VStack>
                                    </Container>
                                    <Container>
                                        <VStack align={'start'}>
                                            <Select onChange={selectLLMCall} required>
                                                <option value={""}>Select LLM Call</option>
                                                {
                                                    spans.data ?
                                                        spans.data?.map((dataset, index) => (
                                                            dataset.type === 'llm' && <option key={index} value={index}>{dataset.model ?? "(noname)"} - {formatNumberWithSuffix(index + 1)} LLM Call</option>
                                                        )) : null
                                                }
                                            </Select>
                                        </VStack>
                                    </Container>
                                </HStack>
                                : null}

                            <HStack align={'start'} gap={8}>
                                {databaseSchema ?
                                    <Text
                                        whiteSpace="nowrap"
                                        bg="gray.200"
                                        paddingX="2"
                                        paddingY="1"
                                        borderRadius="lg"
                                        fontSize={12}
                                    >
                                        {databaseSchemaName}
                                    </Text> : null}
                            </HStack>

                            {databaseSchema !== '' ?
                                <>
                                    <FormControl isInvalid={inputError}>
                                        <HStack marginBottom={2}>
                                            <Text fontWeight={'bold'}> Input</Text>
                                            <Tooltip label="test">
                                                <HelpCircle width="14px" />
                                            </Tooltip>
                                        </HStack>
                                        <Textarea onChange={handleInputChange} rows={5} value={inputSpan} />
                                        <FormErrorMessage >Invalid LLM Chat message format</FormErrorMessage>
                                    </FormControl>

                                    <FormControl isInvalid={outputError}>
                                        <HStack marginBottom={2}>
                                            <Text fontWeight={'bold'}> Output</Text>
                                            <Tooltip label="test">
                                                <HelpCircle width="14px" />
                                            </Tooltip>
                                        </HStack>
                                        <Textarea onChange={handleOutputChange} rows={5} value={outputSpan} />
                                        <FormErrorMessage >Invalid LLM Chat message format</FormErrorMessage>
                                    </FormControl>
                                </> : null
                            }

                            {databaseSchema === DatabaseSchema.FULL_TRACE ?
                                <FormControl isInvalid={outputError}>
                                    <HStack marginBottom={2}>
                                        <Text fontWeight={'bold'}> Spans</Text>
                                        <Tooltip label="test">
                                            <HelpCircle width="14px" />
                                        </Tooltip>
                                    </HStack>
                                    <Textarea onChange={handleSpansChange} rows={10} value={spanTrace} />
                                    <FormErrorMessage >Invalid LLM Chat message format</FormErrorMessage>
                                </FormControl>
                                : null
                            }

                            {databaseSchema !== '' ?
                                <Button
                                    colorScheme="blue"
                                    type="submit"
                                    width="fit-content"
                                >
                                    Add to dataset
                                </Button>
                                : null}
                        </Stack>
                    </form>
                </DrawerBody >
            </DrawerContent >
            <AddDatasetDrawer isOpen={isOpen} onClose={onClose} onSuccess={onCreateDatasetSuccess} />
        </Drawer >
    )
}