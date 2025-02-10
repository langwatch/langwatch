import {
  Box,
  HStack,
  Spacer,
  Text,
  Tooltip,
  VStack,
  Card,
  CardBody,
  Avatar,
  StackDivider,
} from "@chakra-ui/react";
import { useEffect } from "react";
import { Edit, ThumbsDown, ThumbsUp, MessageCircle } from "react-feather";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";
import { useDrawer } from "./CurrentDrawer";

export const Annotations = ({ traceId }: { traceId: string }) => {
  const { data } = useRequiredSession();
  const { isDrawerOpen, openDrawer } = useDrawer();
  const { project, isPublicRoute } = useOrganizationTeamProject();

  const annotations = api.annotation.getByTraceId.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: traceId,
    },
    {
      enabled: !!project?.id,
    }
  );

  const scoreOptions = api.annotationScore.getAll.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id && !isPublicRoute,
    }
  );

  const isAnnotationDrawerOpen = isDrawerOpen("annotation");

  useEffect(() => {
    void annotations.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnnotationDrawerOpen]);

  return (
    <VStack spacing={3} align="start">
      {annotations.data?.map((annotation) => {
        const isCurrentUser = data?.user?.id === annotation.user?.id;
        return (
          <Card
            backgroundColor={"gray.100"}
            width={"full"}
            shadow={"md"}
            onClick={
              isCurrentUser
                ? (e) => {
                    e.stopPropagation();
                    openDrawer("annotation", {
                      traceId: traceId,
                      action: "edit",
                      annotationId: annotation.id,
                    });
                  }
                : undefined
            }
            cursor={isCurrentUser ? "pointer" : "default"}
            key={annotation.id}
          >
            <CardBody>
              <VStack align="start" spacing={3}>
                <HStack width="full" align={"top"}>
                  <Avatar size="sm" name={annotation.user?.name ?? undefined} />
                  <VStack align="start" spacing={0}>
                    <Text fontWeight="bold" fontSize="sm">
                      {annotation.user?.name ?? (
                        <HStack marginBottom={2}>
                          <Box
                            borderRadius={5}
                            paddingY={0.5}
                            paddingX={2}
                            border="1px solid"
                            borderColor="gray.500"
                            fontSize="xs"
                          >
                            API
                          </Box>
                          <Text color="gray.500" fontSize="sm">
                            -{" "}
                            {annotation.email ? annotation.email : "anonymous"}
                          </Text>
                        </HStack>
                      )}
                    </Text>
                    <Text fontSize="xs">
                      {annotation.createdAt.toLocaleString()}
                    </Text>
                  </VStack>
                  <Spacer />
                  {isCurrentUser && (
                    <Tooltip label="Edit Annotation" placement="top" hasArrow>
                      <Edit size={"18px"} />
                    </Tooltip>
                  )}
                </HStack>
                <Text>{annotation.comment}</Text>
                {annotation.isThumbsUp === true ? (
                  <ThumbsUp size={"20px"} />
                ) : annotation.isThumbsUp === false ? (
                  <ThumbsDown size={"20px"} />
                ) : null}
                <HStack
                  align="start"
                  spacing={2}
                  wrap="wrap"
                  divider={<StackDivider borderColor="gray.400" />}
                >
                  {annotation.scoreOptions &&
                    typeof annotation.scoreOptions === "object" &&
                    Object.entries(annotation.scoreOptions).map(
                      ([key, scoreOption]) => {
                        if (
                          !scoreOption ||
                          typeof scoreOption !== "object" ||
                          !("value" in scoreOption)
                        )
                          return null;
                        const name = scoreOptions.data?.find(
                          (option) => option.id === key
                        )?.name;
                        if (!name || !scoreOption.value) return null;
                        return (
                          name && (
                            <Text key={key} fontSize={"sm"}>
                              <VStack align="start" spacing={0}>
                                <Text fontSize="xs" fontWeight="500">
                                  {name}:
                                </Text>
                                {typeof scoreOption === "object" &&
                                  "value" in scoreOption && (
                                    <HStack spacing={1} wrap="wrap">
                                      <Text fontSize="xs">
                                        {Array.isArray(scoreOption.value)
                                          ? scoreOption.value.join(",")
                                          : String(scoreOption.value ?? "")}
                                      </Text>
                                      {scoreOption.reason && (
                                        <Tooltip
                                          label={
                                            typeof scoreOption.reason ===
                                            "object"
                                              ? JSON.stringify(
                                                  scoreOption.reason
                                                )
                                              : scoreOption.reason
                                          }
                                        >
                                          <MessageCircle size={"12px"} />
                                        </Tooltip>
                                      )}
                                    </HStack>
                                  )}
                              </VStack>
                            </Text>
                          )
                        );
                      }
                    )}
                </HStack>
              </VStack>
            </CardBody>
          </Card>
        );
      })}
    </VStack>
  );
};
