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
} from "@chakra-ui/react";
import router from "next/router";

import { Play } from "react-feather";
import { useDrawer } from "~/components/CurrentDrawer";
import { DashboardLayout } from "~/components/DashboardLayout";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

export default function Experiments() {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();

  const experiments = api.experiments.getAllByProjectId.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project,
    }
  );

  return (
    <DashboardLayout>
      <Container maxW={"calc(100vw - 200px)"} padding={6} marginTop={8}>
        <HStack width="full" align="top">
          <Heading as={"h1"} size="lg" paddingBottom={6} paddingTop={1}>
            Experiments
          </Heading>
          <Spacer />
        </HStack>
        <Card>
          <CardBody>
            {experiments.data && experiments.data.length == 0 ? (
              <Text>No records found</Text>
            ) : (
              <TableContainer>
                <Table variant="simple">
                  <Thead>
                    <Tr>
                      <Th>Experiment</Th>
                      <Th>Type</Th>
                      <Th>Created At</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {experiments.isLoading
                      ? Array.from({ length: 3 }).map((_, i) => (
                          <Tr key={i}>
                            {Array.from({ length: 4 }).map((_, i) => (
                              <Td key={i}>
                                <Skeleton height="20px" />
                              </Td>
                            ))}
                          </Tr>
                        ))
                      : experiments.data
                      ? experiments.data?.map((experiment, i) => (
                          <Tr
                            cursor="pointer"
                            onClick={() => {
                              void router.push({
                                pathname: `/${project?.slug}/experiments/${experiment.slug}`,
                              });
                            }}
                            key={i}
                          >
                            <Td>{experiment.name ?? experiment.slug}</Td>
                            <Td>{experiment.type}</Td>
                            <Td>{experiment.createdAt.toLocaleString()}</Td>
                          </Tr>
                        ))
                      : null}
                  </Tbody>
                </Table>
              </TableContainer>
            )}
          </CardBody>
        </Card>
      </Container>
    </DashboardLayout>
  );
}
