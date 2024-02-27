import {
    Button,
    Card,
    CardBody,
    Container,
    HStack,
    Heading,
    Skeleton,
    Spacer,
    Table,
    TableContainer,
    Tbody,
    Td,
    Text,
    Th,
    Thead,
    Tr,
    Box,
    useDisclosure
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import { DashboardLayout } from "~/components/DashboardLayout";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { AddDatasetDrawer } from "~/components/AddDatasetDrawer";
import { displayName } from "~/utils/datasets";
import { DatabaseSchema } from "@prisma/client";




export default function Dataset() {
    const router = useRouter();
    const { project } = useOrganizationTeamProject();
    const dataSetId = router.query.id;

    const { isOpen, onOpen, onClose } = useDisclosure();
    const dataset = api.datasetRecord.getAll.useQuery({ projectId: project?.id ?? "", datasetId: dataSetId as string },
        {
            enabled: !!project,

        });

    const onSuccess = () => {
        void dataset.refetch();
        onClose();
    }

    return (
        <DashboardLayout>
            <Container maxW={"calc(100vw - 200px)"} padding={6} marginTop={8}>
                <HStack width="full" verticalAlign={"middle"} paddingBottom={6} >
                    <Heading as={"h1"} size="lg">
                        Dataset {`- ${dataset.data?.name ?? ""}`}
                    </Heading>
                    <Text
                        whiteSpace="nowrap"
                        bg="gray.200"
                        paddingX="2"
                        paddingY="1"
                        borderRadius="lg"
                        fontSize={12}
                        marginLeft={4}
                    >
                        {dataset.data ? displayName(dataset.data?.schema) : ""}
                    </Text>
                    <Spacer />
                    <Button
                        colorScheme="blue"
                        onClick={() => {
                            onOpen();
                        }}
                        minWidth="fit-content"
                    >
                        + Create New Dataset
                    </Button>
                </HStack>
                <Card>
                    <CardBody>
                        {dataset.data && dataset.data.datasetRecords.length == 0 ? <Text>No data found</Text> : <TableContainer>
                            <Table variant="simple">
                                <Thead>
                                    <Tr>
                                        <Th>Input</Th>
                                        <Th>Expected Output</Th>
                                        <Th>Created at</Th>
                                        <Th>Updated at</Th>
                                    </Tr>
                                </Thead>
                                <Tbody>
                                    {dataset.isLoading ? (
                                        Array.from({ length: 3 }).map((_, i) => (
                                            <Tr key={i}>
                                                {Array.from({ length: 4 }).map((_, i) => (
                                                    <Td key={i}>
                                                        <Skeleton height="20px" />
                                                    </Td>
                                                ))}
                                            </Tr>
                                        ))
                                    ) : dataset.data ?
                                        dataset.data.datasetRecords?.map((dataset) => (
                                            <Tr key={dataset.id}>
                                                <Td >
                                                    <Text noOfLines={1} maxWidth="300px" display="block">
                                                        {(dataset as any)?.entry?.input[0]?.content ?? ""}
                                                    </Text>
                                                </Td>
                                                <Td >
                                                    <Text noOfLines={1} display="block" maxWidth="300px">
                                                        {(dataset as any)?.entry?.output[0]?.content ?? ""}
                                                    </Text>
                                                </Td>
                                                <Td>{new Date(dataset.createdAt).toLocaleString()}</Td>
                                                <Td>{new Date(dataset.updatedAt).toLocaleString()}</Td>
                                            </Tr>
                                        )
                                        ) : null
                                    }
                                </Tbody>
                            </Table>
                        </TableContainer>}
                    </CardBody>
                </Card>
            </Container>
            <AddDatasetDrawer isOpen={isOpen} onClose={onClose} onSuccess={onSuccess} />
        </DashboardLayout >
    );
}
