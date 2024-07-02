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
  Tooltip,
} from "@chakra-ui/react";

import { DeleteIcon } from "@chakra-ui/icons";
import { useRouter } from "next/router";
import { MoreVertical, Play, ThumbsDown, ThumbsUp } from "react-feather";
import { AddDatasetDrawer } from "~/components/AddDatasetDrawer";
import { useDrawer } from "~/components/CurrentDrawer";
import { DashboardLayout } from "~/components/DashboardLayout";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { schemaDisplayName } from "~/utils/datasets";
import { HelpCircle } from "react-feather";
import { useEffect } from "react";

export default function Annotations() {
  const { project } = useOrganizationTeamProject();
  const { openDrawer, isDrawerOpen } = useDrawer();

  const annotations = api.annotation.getAll.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project,
    }
  );

  const scoreOptions = api.annotationScore.getAll.useQuery({
    projectId: project?.id ?? "",
  });

  const openTraceDrawer = (traceId: string) => {
    openDrawer("traceDetails", {
      traceId: traceId,
      annotationTab: true,
    });
  };

  const isAnnotationDrawerOpen = isDrawerOpen("annotation");
  const isTraceDrawerOpen = isDrawerOpen("traceDetails");

  useEffect(() => {
    void annotations.refetch();
  }, [isAnnotationDrawerOpen, isTraceDrawerOpen]);

  const annotationScoreValues = (scoreOptions: object) => {
    console.log("uu", scoreOptions);
    return Object.entries(scoreOptions).map(([key, value]) => (
      <Td key={key}>
        <HStack>
          <Text>{value.value}</Text>
          {value.reason && (
            <Tooltip label={value.reason}>
              <HelpCircle width={16} height={16} />
            </Tooltip>
          )}
        </HStack>
      </Td>
    ));
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
                      <Th>Rating</Th>

                      {scoreOptions.data?.map((key) => (
                        <Th key={key.id}>{key.name}</Th>
                      ))}
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
                          <Tr
                            cursor="pointer"
                            key={annotation.id}
                            onClick={() => openTraceDrawer(annotation.traceId)}
                          >
                            <Td>{annotation.comment}</Td>
                            <Td>{annotation.traceId}</Td>
                            <Td>
                              {annotation.isThumbsUp ? (
                                <ThumbsUp />
                              ) : (
                                <ThumbsDown />
                              )}
                            </Td>
                            {annotationScoreValues(annotation.scoreOptions)}
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
