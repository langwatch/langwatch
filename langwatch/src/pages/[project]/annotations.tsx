import { DownloadIcon } from "@chakra-ui/icons";
import {
  Avatar,
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
  Tooltip,
  Tr,
} from "@chakra-ui/react";
import Parse from "papaparse";

import { useEffect } from "react";
import { HelpCircle, ThumbsDown, ThumbsUp } from "react-feather";
import { useDrawer } from "~/components/CurrentDrawer";
import { DashboardLayout } from "~/components/DashboardLayout";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

export default function Annotations() {
  const { project } = useOrganizationTeamProject();
  const { openDrawer, isDrawerOpen } = useDrawer();

  const annotations = api.annotation.getAll.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project,
    }
  );

  const scoreOptions = api.annotationScore.getAll.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project,
    }
  );

  const scoreOptionsIDArray = scoreOptions.data
    ? scoreOptions.data.map((scoreOption) => scoreOption.id)
    : [];

  const downloadCSV = () => {
    const fields = [
      "User",
      "Comment",
      "Trace ID",
      "Rating",
      "Scoring",
      "Created At",
    ];

    const csv = annotations.data?.map((annotation) => {
      return [
        annotation.user?.name,
        annotation.comment,
        annotation.traceId,
        annotation.isThumbsUp ? "Thumbs Up" : "Thumbs Down",
        JSON.stringify(annotation.scoreOptions),
        annotation.createdAt.toLocaleString(),
      ];
    });

    const csvBlob = Parse.unparse({
      fields: fields,
      data: csv ?? [],
    });

    const url = window.URL.createObjectURL(new Blob([csvBlob]));

    const link = document.createElement("a");
    link.href = url;
    const today = new Date();
    const formattedDate = today.toISOString().split("T")[0];
    const fileName = `Messages - ${formattedDate}.csv`;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

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

  interface ScoreOption {
    value: string;
    reason?: string;
  }

  const annotationScoreValues = (
    scoreOptions: Record<string, ScoreOption>,
    scoreOptionsIDArray: string[]
  ) => {
    console.log(scoreOptions, scoreOptionsIDArray);
    if (scoreOptionsIDArray.length > 0 && scoreOptions) {
      return scoreOptionsIDArray.map((id) => (
        <Td key={id}>
          <HStack>
            <Text>{scoreOptions[id]?.value}</Text>
            {scoreOptions[id]?.reason && (
              <Tooltip label={scoreOptions[id]?.reason}>
                <HelpCircle width={16} height={16} />
              </Tooltip>
            )}
          </HStack>
        </Td>
      ));
    } else {
      return <Td></Td>;
    }
  };

  return (
    <DashboardLayout>
      <Container maxW={"calc(100vw - 200px)"} padding={6} marginTop={8}>
        <HStack width="full" align="top">
          <Heading as={"h1"} size="lg" paddingBottom={6} paddingTop={1}>
            Annotations
          </Heading>
          <Spacer />
          <Button
            colorScheme="black"
            minWidth="fit-content"
            variant="ghost"
            onClick={() => downloadCSV()}
          >
            Export all <DownloadIcon marginLeft={2} />
          </Button>
        </HStack>
        <Card>
          <CardBody>
            {annotations.data &&
            annotations.data.length == 0 &&
            scoreOptions.data &&
            scoreOptions.data.length == 0 ? (
              <Text>No annotations found</Text>
            ) : (
              <TableContainer>
                <Table variant="simple">
                  <Thead>
                    <Tr>
                      <Th>User</Th>
                      <Th>Comment</Th>
                      <Th>Trace ID</Th>
                      <Th>Rating</Th>

                      {scoreOptions.data &&
                        scoreOptions.data.length > 0 &&
                        scoreOptions.data?.map((key) => (
                          <Th key={key.id}>{key.name}</Th>
                        ))}
                      <Th>Created At</Th>
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
                      : annotations.data && annotations.data.length > 0
                      ? annotations.data?.map((annotation) => (
                          <Tr
                            cursor="pointer"
                            key={annotation.id}
                            onClick={() => openTraceDrawer(annotation.traceId)}
                          >
                            <Td>
                              <Avatar
                                name={annotation.user?.name ?? undefined}
                                backgroundColor={"orange.400"}
                                color="white"
                                size="sm"
                              />
                            </Td>
                            <Td>{annotation.comment}</Td>
                            <Td>{annotation.traceId}</Td>
                            <Td>
                              {annotation.isThumbsUp ? (
                                <ThumbsUp />
                              ) : (
                                <ThumbsDown />
                              )}
                            </Td>
                            {scoreOptions.data &&
                              scoreOptions.data.length > 0 &&
                              annotationScoreValues(
                                annotation.scoreOptions as unknown as Record<
                                  string,
                                  ScoreOption
                                >,
                                scoreOptionsIDArray
                              )}
                            <Td>{annotation.createdAt.toLocaleString()}</Td>
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
