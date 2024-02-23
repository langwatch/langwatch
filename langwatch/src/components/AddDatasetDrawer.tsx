import { Box, Button, Container, Drawer, DrawerBody, DrawerCloseButton, DrawerContent, DrawerHeader, FormControl, FormErrorMessage, FormHelperText, HStack, Input, Radio, RadioGroup, Stack, VStack, useToast, Text } from "@chakra-ui/react";
import { DatabaseSchema } from "@prisma/client";
import { useState, useEffect } from "react";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import slugify from "slugify";


interface AddDatasetDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export function AddDatasetDrawer(props: AddDatasetDrawerProps) {

    const [schemaValue, setSchemaValue] = useState<string>(DatabaseSchema.FULL_TRACE);
    const [dataSetName, setDataSetName] = useState<string>("");
    const [slug, setSlug] = useState<string>("");
    const [hasError, setHasError] = useState<boolean>(false);
    const { project } = useOrganizationTeamProject();




    const toast = useToast();

    const createDataset = api.dataset.create.useMutation();

    const onSubmit = (e: any) => {
        e.preventDefault()
        createDataset.mutate({
            projectId: project?.id ?? "",
            name: dataSetName,
            schema: schemaValue
        },
            {
                onSuccess: () => {
                    props.onSuccess();
                    setSlug("");

                    toast({
                        title: "Dataset Created",
                        description: `You have successfully created the dataset ${dataSetName}`,

                        status: "success",
                        duration: 5000,
                        isClosable: true,
                        position: "top-right",
                    });
                }
            })
    }

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        createDataset.reset()
        setHasError(false)
        setDataSetName(e.target.value)
        setSlug(slugify(e.target.value || "", { lower: true, strict: true, }))
    }

    useEffect(() => {
        if (createDataset.error) {
            setHasError(true)
        }
    }, [createDataset.error])

    return (
        <Drawer
            isOpen={props.isOpen}
            placement="right"
            size={'xl'}
            onClose={props.onClose}
        >
            <DrawerContent>
                <DrawerHeader>
                    <HStack>
                        <DrawerCloseButton />
                    </HStack>
                    <HStack>
                        <Text paddingTop={5} fontSize='2xl'>New Dataset</Text>
                    </HStack>
                </DrawerHeader>
                <DrawerBody>
                    <form onSubmit={onSubmit}>
                        <HStack align={'start'} gap={12}>
                            <Container padding={0}>
                                <VStack align={'start'} padding={0}>
                                    <Text fontWeight={'bold'}>Name</Text>
                                    <Text fontSize={'sm'}>Give it a name that identifies hat this groups of examples is going to focus on</Text>
                                </VStack>
                            </Container>
                            <Container>
                                <VStack align={'start'}>
                                    <FormControl isInvalid={hasError}>
                                        <Input placeholder="Good Responses Dataset" onChange={handleInputChange} required />
                                        <FormHelperText>slug: {slug}</FormHelperText>
                                        <FormErrorMessage >{createDataset.error?.message}</FormErrorMessage>
                                    </FormControl>
                                </VStack>
                            </Container>
                        </HStack>
                        <HStack align={'start'} marginTop={8} gap={12}>
                            <Container padding={0}>
                                <VStack align={'start'} padding={0}>
                                    <Text fontWeight={'bold'}>Schema</Text>
                                    <Text fontSize={'sm'}>Define the type if structure for this dataset</Text>
                                </VStack>
                            </Container>
                            <Container>
                                <VStack align={'start'}>
                                    <RadioGroup value={schemaValue} onChange={setSchemaValue}>
                                        <Stack spacing={4}>
                                            <HStack align={'start'}>
                                                <Radio size="md" value={DatabaseSchema.FULL_TRACE} colorScheme="blue" padding={1} />
                                                <Box>
                                                    <Text fontWeight="bold">Full Trace</Text>
                                                    <Text>Each entry will include all the spans of a complete trace call, that is, all the steps on your pipeline, and the expected output</Text>
                                                </Box>
                                            </HStack>
                                            <HStack align={'start'}>
                                                <Radio size="md" value={DatabaseSchema.LLM_CHAT_CALL} colorScheme="blue" padding={1} />
                                                <Box>
                                                    <Text fontWeight="bold">LLM Call</Text>
                                                    <Text>Each entry will be a single LLM Call with the expected output, this allows you to focus on improving on a single step of your pipeline with both the playground and manual runs</Text>
                                                </Box>
                                            </HStack>
                                            <HStack align={'start'}>
                                                <Radio size="md" value={DatabaseSchema.STRING_I_O} colorScheme="blue" padding={1} />
                                                <Box>
                                                    <Text fontWeight="bold">String Input/Output</Text>
                                                    <Text>Each entry will be a simple input/output string pair, for running batch evaluations without the whole LLM structure</Text>
                                                </Box>
                                            </HStack>
                                            <HStack align={'start'}>
                                                <Radio size="md" value={DatabaseSchema.KEY_VALUE} colorScheme="blue" padding={1} />
                                                <Box>
                                                    <Text fontWeight="bold">Key-Value</Text>
                                                    <Text>You can use the generic key-value schema for storing any dataset format, however requires manual implementation for batch evaluations</Text>
                                                </Box>
                                            </HStack>
                                        </Stack>
                                    </RadioGroup>
                                </VStack>
                            </Container>
                        </HStack>
                        <Button
                            colorScheme="blue"
                            type="submit"
                            minWidth="fit-content"
                        >
                            Create Dataset
                        </Button>
                    </form>
                </DrawerBody >
            </DrawerContent >
        </Drawer >
    )
}