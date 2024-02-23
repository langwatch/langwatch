import { Button, Container, Drawer, DrawerBody, DrawerCloseButton, DrawerContent, DrawerHeader, FormControl, FormErrorMessage, FormHelperText, HStack, Select, Stack, Text, Textarea, VStack, useToast, useDisclosure } from "@chakra-ui/react";
import { useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useTraceDetailsState } from "~/hooks/useTraceDetailsState";
import { api } from "~/utils/api";
import numeral from "numeral";
import { chatMessageSchema } from "~/server/tracer/types.generated";
import { z } from "zod";
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
    const [inputError, setInputError] = useState<boolean>(false);
    const [outputError, setOutputError] = useState<boolean>(false);

    const { onOpen, onClose, isOpen } = useDisclosure()

    const { traceId } = useTraceDetailsState(props?.traceId);

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
    }

    const onSubmit = (e: any) => {
        console.log(inputSpan);
        console.log(outputSpan);

        e.preventDefault()
        createDatasetRecord.mutate({
            projectId: project?.id ?? "",
            input: JSON.parse(inputSpan),
            output: JSON.parse(outputSpan),
            datasetId: datasetId

        },
            {
                onSuccess: () => {
                    props.onClose();
                    toast({
                        title: "Data Added",
                        description: `You have successfully added data the dataset`,
                        status: "success",
                        duration: 5000,
                        isClosable: true,
                        position: "top-right",
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
        }
    }


    const handleInputChange = (e: any) => {

        const inputValue = e.target.value
        const inputTypeCheck = z.array(chatMessageSchema)
        const result = inputTypeCheck.safeParse(JSON.parse(inputValue))
        setInputSpan(inputValue)

        if (!result.success) {
            setInputError(true)
        } else {
            setInputError(false)
        }
    }

    const handleOutputChange = (e: any) => {

        const outputValue = e.target.value
        const outputTypeCheck = z.array(chatMessageSchema)
        const result = outputTypeCheck.safeParse(JSON.parse(outputValue))
        setOutputSpan(outputValue)

        if (!result.success) {
            setOutputError(true)
        } else {
            setOutputError(false)
        }
    }

    return (
        <Drawer
            isOpen={props.isOpen}
            placement="right"
            size={'xl'}
            onClose={handleOnClose}
        >
            <DrawerContent>
                <DrawerHeader>
                    <HStack>
                        <DrawerCloseButton />
                    </HStack>
                    <HStack>
                        <Text paddingTop={5} fontSize='3xl'>Add to Dataset</Text>
                    </HStack>
                </DrawerHeader>
                <DrawerBody>
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
                                            <Select required onChange={(e) => { setDatasetId(e.target.value) }}>
                                                <option value={""}>Select Dataset</option>
                                                {
                                                    datasets.data ?
                                                        datasets.data?.map((dataset, index) => (
                                                            <option key={index} value={dataset.id}>{dataset.name}</option>
                                                        )) : null
                                                }
                                            </Select>
                                            <FormHelperText fontSize={'sm'} color={'blue.500'} onClick={onOpen}>+ Create New</FormHelperText>
                                        </FormControl>
                                    </VStack>
                                </Container>
                            </HStack>

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
                                                        dataset.type === 'llm' && <option key={index} value={index}>{dataset.model + dataset.type} - {formatNumberWithSuffix(index + 1)}</option>
                                                    )) : null
                                            }
                                        </Select>
                                    </VStack>
                                </Container>
                            </HStack>
                            <Text fontWeight={'bold'}>Input</Text>
                            <FormControl isInvalid={inputError}>
                                <Textarea onChange={handleInputChange} rows={5} value={inputSpan} />
                                <FormErrorMessage >Invalid LLM Chat message format</FormErrorMessage>
                            </FormControl>

                            <FormControl isInvalid={outputError}>
                                <Text fontWeight={'bold'}>Expected Output</Text>
                                <Textarea onChange={handleOutputChange} rows={5} value={outputSpan} />
                                <FormErrorMessage >Invalid LLM Chat message format</FormErrorMessage>
                            </FormControl>


                            <Button
                                colorScheme="blue"
                                type="submit"
                                width="fit-content"
                            >
                                Add to dataset
                            </Button>
                        </Stack>
                    </form>
                </DrawerBody >
            </DrawerContent >
            <AddDatasetDrawer isOpen={isOpen} onClose={onClose} onSuccess={onCreateDatasetSuccess} />
        </Drawer >
    )
}