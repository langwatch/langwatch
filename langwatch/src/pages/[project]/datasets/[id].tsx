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
    useDisclosure
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import { DashboardLayout } from "~/components/DashboardLayout";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { AddDatasetDrawer } from "~/components/AddDatasetDrawer";


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
                <HStack width="full" align="top">
                    <Heading as={"h1"} size="lg" paddingBottom={6} paddingTop={1}>
                        Dataset {`- ${dataset.data?.name ?? ""}`}
                    </Heading>
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
                                                <Td>{(dataset as any)?.entry?.input[0]?.content ?? ""}</Td>
                                                <Td>{(dataset as any)?.entry?.output[0]?.content ?? ""}</Td>
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
