import {
  Avatar,
  Box,
  Card,
  HStack,
  Separator,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Edit, MessageCircle, ThumbsDown, ThumbsUp } from "react-feather";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";
import { Tooltip } from "~/components/ui/tooltip";
import { useAnnotationCommentStore } from "../hooks/useAnnotationCommentStore";
import { AnnotationComment } from "./annotations/AnnotationComment";

export const Annotations = ({
  traceId,
  setHover,
}: {
  traceId: string;
  setHover: (hover: boolean) => void;
}) => {
  const { data } = useRequiredSession();
  const { project, isPublicRoute } = useOrganizationTeamProject();
  const commentState = useAnnotationCommentStore();

  const annotations = api.annotation.getByTraceId.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: traceId,
    },
    { enabled: !!project?.id }
  );

  const scoreOptions = api.annotationScore.getAll.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id && !isPublicRoute,
    }
  );

  return (
    <VStack gap={3} align="start" paddingY={4}>
      {annotations.data?.map((annotation) => {
        const isCurrentUser = data?.user?.id === annotation.user?.id;

        if (
          commentState.annotationId === annotation.id &&
          commentState.action === "edit"
        ) {
          return (
            <Box
              key={annotation.id}
              onMouseEnter={() => setHover(true)}
              onMouseMove={() => setHover(true)}
              onMouseLeave={() => setHover(false)}
            >
              <AnnotationComment key={annotation.id} />
            </Box>
          );
        }

        return (
          <Card.Root
            backgroundColor="gray.200"
            border="none"
            width={"full"}
            onClick={
              isCurrentUser
                ? (e) => {
                    e.stopPropagation();
                    commentState.setCommentState?.({
                      traceId: traceId,
                      action: "edit",
                      annotationId: annotation.id,
                      expectedOutput: annotation.expectedOutput,
                      expectedOutputAction: "edit",
                    });
                  }
                : undefined
            }
            onMouseEnter={() => setHover(true)}
            onMouseMove={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            cursor={isCurrentUser ? "pointer" : "default"}
            key={annotation.id}
          >
            <Card.Body>
              <VStack align="start" gap={3}>
                <HStack width="full" align={"top"}>
                  <Avatar.Root size="sm" background="gray.400" color="white">
                    <Avatar.Fallback
                      name={annotation.user?.name ?? undefined}
                    />
                  </Avatar.Root>
                  <VStack align="start" gap={0}>
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
                    <Tooltip
                      content="Edit Annotation"
                      positioning={{ placement: "top" }}
                      showArrow
                    >
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
                <HStack align="start" gap={2} wrap="wrap" divideY="1px">
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
                              <VStack align="start" gap={0}>
                                <Text fontSize="xs" fontWeight="500">
                                  {name}:
                                </Text>
                                {typeof scoreOption === "object" &&
                                  "value" in scoreOption && (
                                    <HStack gap={1} wrap="wrap">
                                      <Text fontSize="xs">
                                        {Array.isArray(scoreOption.value)
                                          ? scoreOption.value.join(",")
                                          : String(scoreOption.value ?? "")}
                                      </Text>
                                      {scoreOption.reason && (
                                        <Tooltip
                                          content={
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
            </Card.Body>
          </Card.Root>
        );
      })}
      {commentState.action === "new" && commentState.traceId === traceId && (
        <AnnotationComment key={commentState.annotationId ?? ""} />
      )}
    </VStack>
  );
};
