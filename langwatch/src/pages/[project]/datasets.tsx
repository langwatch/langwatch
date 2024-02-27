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
import { displayName } from "~/utils/datasets";

export default function Datasets() {

    const { isOpen, onOpen, onClose } = useDisclosure();
    const { project } = useOrganizationTeamProject();
    const router = useRouter();


    const datasets = api.dataset.getAll.useQuery({ projectId: project?.id ?? "" },
        {
            enabled: !!project,

        });

    const onSuccess = () => {
        void datasets.refetch();
        onClose();
    }

    const goToDataset = (id: string) => {
        void router.push({
            pathname: `/${project?.slug}/datasets/${id}`,
            query: { ...router.query }
        });
    }

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
                            onOpen();
                        }}
                        minWidth="fit-content"
                    >
                        + Create New Dataset
                    </Button>
                </HStack>
                <Card>
                    <CardBody>
                        {datasets.data && datasets.data.length == 0 ? <Text>No datasets found</Text> : <TableContainer>
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
                                            <Tr cursor="pointer" onClick={() => goToDataset(dataset.id)} key={dataset.id}>
                                                <Td>{dataset.name}</Td>
                                                <Td>{displayName(dataset.schema)}</Td>
                                                <Td>{dataset.datasetRecords.length ?? 0}</Td>
                                                <Td>{new Date(dataset.datasetRecords[0]?.createdAt ?? dataset.createdAt).toLocaleString()}</Td>
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
