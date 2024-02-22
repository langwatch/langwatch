import {
    Box,
    Button,
    Card,
    CardBody,
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
    Heading,
    Input,
    Radio,
    RadioGroup,
    Skeleton,
    Spacer,
    Stack,
    Table,
    TableContainer,
    Tbody,
    Td,
    Text,
    Th,
    Thead,
    Tr,
    VStack,
    useDisclosure,
    useToast,
} from "@chakra-ui/react";
import { useState, useEffect } from "react";
import slugify from "slugify";
import { DashboardLayout } from "~/components/DashboardLayout";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { al } from "vitest/dist/reporters-5f784f42";
import { on } from "events";
import vitestConfig from "vitest.config";


export default function Datasets() {

    const { isOpen, onOpen, onClose } = useDisclosure();
    const { project } = useOrganizationTeamProject();
    const toast = useToast();

    const [schemaValue, setSchemaValue] = useState<string>("full-trace");
    const [dataSetName, setDataSetName] = useState<string>("");
    const [slug, setSlug] = useState<string>("");
    const [hasError, setHasError] = useState<boolean>(false);


    const createDataset = api.dataset.create.useMutation();


    const datasets = api.dataset.getAll.useQuery({ projectId: project?.id ?? "" },
        {
            enabled: !!project,

        });


    const onSubmit = (e: any) => {
        e.preventDefault()
        createDataset.mutate({
            projectId: project?.id ?? "",
            name: dataSetName,
            schema: schemaValue
        },
            {
                onSuccess: () => {
                    onClose();

                    void datasets.refetch();

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
        <DashboardLayout>
            <Container maxW={"calc(100vw - 200px)"} padding={6} marginTop={8}>
                <HStack width="full" align="top">
                    <Heading as={"h1"} size="lg" paddingBottom={6} paddingTop={1}>
                        Datasets
                    </Heading>
                    <Spacer />
                    <Button
                        colorScheme="blue"
                        onClick={() => {
                            setHasError(false);
                            setDataSetName("");
                            setSlug("");
                            onOpen();
                        }}
                        minWidth="fit-content"
                    >
                        + Create New Dataset
                    </Button>
                </HStack>
                <Card>
                    <CardBody>
                        <TableContainer>
                            <Table variant="simple">
                                <Thead>
                                    <Tr>
                                        <Th>Name</Th>
                                        <Th>Schema</Th>
                                        <Th>Entries</Th>
                                        <Th>Last Update</Th>
                                    </Tr>
                                </Thead>
                                <Tbody>
                                    {datasets.isLoading ? (
                                        Array.from({ length: 3 }).map((_, i) => (
                                            <Tr key={i}>
                                                {Array.from({ length: 4 }).map((_, i) => (
                                                    <Td key={i}>
                                                        <Skeleton height="20px" />
                                                    </Td>
                                                ))}
                                            </Tr>
                                        ))
                                    ) : datasets.data ?
                                        datasets.data?.map((dataset) => (
                                            <Tr key={dataset.id}>
                                                <Td>{dataset.name}</Td>
                                                <Td>{dataset.schema}</Td>
                                                <Td>0</Td>
                                                <Td>2021-10-10</Td>
                                            </Tr>
                                        )
                                        ) : null
                                    }
                                </Tbody>
                            </Table>
                        </TableContainer>
                    </CardBody>
                </Card>
            </Container>
            <Drawer
                isOpen={isOpen}
                placement="right"
                size={'xl'}
                onClose={onClose}
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
                                            {<FormErrorMessage >{createDataset.error?.message}</FormErrorMessage>}
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
                                                    <Radio size="md" value="full-trace" colorScheme="blue" padding={1} />
                                                    <Box>
                                                        <Text fontWeight="bold">Full Trace</Text>
                                                        <Text>Each entry will include all the spans of a complete trace call, that is, all the steps on your pipeline, and the expected output</Text>
                                                    </Box>
                                                </HStack>
                                                <HStack align={'start'}>
                                                    <Radio size="md" value="llm-call" colorScheme="blue" padding={1} />
                                                    <Box>
                                                        <Text fontWeight="bold">LLM Call</Text>
                                                        <Text>Each entry will be a single LLM Call with the expected output, this allows you to focus on improving on a single step of your pipeline with both the playground and manual runs</Text>
                                                    </Box>
                                                </HStack>
                                                <HStack align={'start'}>
                                                    <Radio size="md" value="string-i-o" colorScheme="blue" padding={1} />
                                                    <Box>
                                                        <Text fontWeight="bold">String Input/Output</Text>
                                                        <Text>Each entry will be a simple input/output string pair, for running batch evaluations without the whole LLM structure</Text>
                                                    </Box>
                                                </HStack>
                                                <HStack align={'start'}>
                                                    <Radio size="md" value="key-value" colorScheme="blue" padding={1} />
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
        </DashboardLayout >
    );
}
