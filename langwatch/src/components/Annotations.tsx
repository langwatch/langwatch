import { VStack, HStack, Spacer, Box, Text, Card } from "@chakra-ui/react";
import { api } from "~/utils/api";
import { useEffect } from "react";
import { Edit, ThumbsUp, ThumbsDown } from "react-feather";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { useDrawer } from "./CurrentDrawer";

export const Annotations = ({ traceId }: { traceId: string }) => {
  const { data } = useRequiredSession();
  const { isDrawerOpen, openDrawer } = useDrawer();
  const { project } = useOrganizationTeamProject();

  const annotations = api.annotation.getByTraceId.useQuery({
    projectId: project?.id ?? "",
    traceId: traceId,
  });

  const scoreOptions = api.annotationScore.getAll.useQuery({
    projectId: project?.id ?? "",
  });

  const isAnnotationDrawerOpen = isDrawerOpen("annotation");

  useEffect(() => {
    void annotations.refetch();
  }, [isAnnotationDrawerOpen]);

  return (
    <VStack spacing={2} align="start">
      {annotations.data?.map((annotation) => {
        const isCurrentUser = data?.user?.id === annotation.user?.id;
        return (
          <Box
            backgroundColor={"gray.100"}
            width={"full"}
            padding={6}
            borderRadius={"lg"}
            onClick={
              isCurrentUser
                ? () =>
                    openDrawer("annotation", {
                      traceId: traceId,
                      action: "edit",
                      annotationId: annotation.id,
                    })
                : undefined
            }
            cursor={isCurrentUser ? "pointer" : "default"}
            key={annotation.id}
          >
            <VStack align="start">
              <HStack width="full" align={"top"}>
                <VStack align="start" spacing={0}>
                  <Text fontWeight="bold">
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
                          - {annotation.email ? annotation.email : "anonymous"}
                        </Text>
                      </HStack>
                    )}
                  </Text>
                  <Text fontSize="sm">
                    {annotation.createdAt.toLocaleString()}
                  </Text>
                </VStack>
                <Spacer />
                {isCurrentUser && <Edit size={"18px"} />}
                {annotation.isThumbsUp ? (
                  <ThumbsUp size={"18px"} />
                ) : (
                  <ThumbsDown size={"18px"} />
                )}
              </HStack>
              <Text>{annotation.comment}</Text>
              <VStack align="start" spacing={0}>
                {annotation.scoreOptions &&
                  typeof annotation.scoreOptions === "object" &&
                  Object.entries(annotation.scoreOptions).map(
                    ([key, scoreOption]) => {
                      return (
                        <Text key={key} fontSize={"sm"}>
                          <HStack>
                            <Text fontWeight="bold">
                              {scoreOptions.data?.find(
                                (option) => option.id === key
                              )?.name ?? "Name not found"}
                              :
                            </Text>
                            <Text key={key}>{scoreOption as string}</Text>
                          </HStack>
                        </Text>
                      );
                    }
                  )}
              </VStack>
            </VStack>
          </Box>
        );
      })}
    </VStack>
  );
};
