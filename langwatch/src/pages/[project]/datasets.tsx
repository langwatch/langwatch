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

import { DashboardLayout } from "~/components/DashboardLayout";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

import { DatabaseSchema } from "@prisma/client";

import { AddDatasetDrawer } from "~/components/AddDatasetDrawer";


export default function Datasets() {

    const { isOpen, onOpen, onClose } = useDisclosure();
    const { project } = useOrganizationTeamProject();

    const datasets = api.dataset.getAll.useQuery({ projectId: project?.id ?? "" },
        {
            enabled: !!project,

        });

    const onSuccess = () => {
        void datasets.refetch();
        onClose();
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
                            // setHasError(false);
                            // setDataSetName("");
                            // setSlug("");
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
                        </TableContainer>}
                    </CardBody>
                </Card>
            </Container>

            <AddDatasetDrawer isOpen={isOpen} onClose={onClose} onSuccess={onSuccess} />

        </DashboardLayout >
    );
}
