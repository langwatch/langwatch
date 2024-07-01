import {
  Button,
  Card,
  CardBody,
  Container,
  HStack,
  Heading,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Skeleton,
  Spacer,
  Table,
  TableContainer,
  Tag,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  useDisclosure,
  useToast,
} from "@chakra-ui/react";

import { DeleteIcon } from "@chakra-ui/icons";
import { useRouter } from "next/router";
import { MoreVertical, Play } from "react-feather";
import { AddDatasetDrawer } from "~/components/AddDatasetDrawer";
import { useDrawer } from "~/components/CurrentDrawer";
import { DashboardLayout } from "~/components/DashboardLayout";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { schemaDisplayName } from "~/utils/datasets";

export default function Annotations() {
  const { project } = useOrganizationTeamProject();

  const annotations = api.annotation.getAll.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project,
    }
  );

  const scoreOptions = api.annotationScore.getAll.useQuery({
    projectId: project?.id ?? "",
  });

  console.log(annotations);

  const onSuccess = () => {
    void annotations.refetch();
  };

  const getType = (score: object) => {
    console.log(score);
    const scoreOption = scoreOptions.data?.find((s) => s.id === score);
    return scoreOption?.name;
  };

  return (
    <DashboardLayout>
      <Container maxW={"calc(100vw - 200px)"} padding={6} marginTop={8}>
        <HStack width="full" align="top">
          <Heading as={"h1"} size="lg" paddingBottom={6} paddingTop={1}>
            Annotations
          </Heading>
        </HStack>
        <Card>
          <CardBody>
            {annotations.data && annotations.data.length == 0 ? (
              <Text>No annotations found</Text>
            ) : (
              <TableContainer>
                <Table variant="simple">
                  <Thead>
                    <Tr>
                      <Th>Comment</Th>
                      <Th>Trace ID</Th>
                      <Th>Datatype (Boolean)</Th>
                      <Th>Entries</Th>
                      <Th width={240}>Last Update</Th>
                      <Th width={20}></Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {annotations.isLoading
                      ? Array.from({ length: 3 }).map((_, i) => (
                          <Tr key={i}>
                            {Array.from({ length: 4 }).map((_, i) => (
                              <Td key={i}>
                                <Skeleton height="20px" />
                              </Td>
                            ))}
                          </Tr>
                        ))
                      : annotations.data
                      ? annotations.data?.map((annotation) => (
                          <Tr cursor="pointer" key={annotation.id}>
                            <Td>{annotation.comment}</Td>
                            <Td>{annotation.traceId}</Td>
                            <Td>{getType(annotation.scoreOptions)}</Td>
                            <Td></Td>
                            <Td></Td>
                            <Td></Td>
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
