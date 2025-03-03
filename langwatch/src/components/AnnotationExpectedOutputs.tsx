import { Avatar, HStack, Text, Textarea, VStack } from "@chakra-ui/react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";
import { useAnnotationCommentStore } from "../hooks/useAnnotationCommentStore";

export const AnnotationExpectedOutputs = ({
  traceId,
}: {
  traceId: string;
  setHover: (hover: boolean) => void;
  output: string;
}) => {
  const { project } = useOrganizationTeamProject();
  const commentState = useAnnotationCommentStore();

  const {
    annotationId,

    expectedOutput,
    setExpectedOutput,
  } = commentState;

  const annotations = api.annotation.getByTraceId.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: traceId,
    },
    {
      enabled: !!project?.id,
    }
  );

  return (
    <VStack gap={3} align="start" paddingY={4} width="full">
      {commentState.expectedOutputAction === "new" && (
        <>
          <Textarea
            width="full"
            backgroundColor="white"
            value={expectedOutput ?? ""}
            placeholder="Enter your expected output here..."
            onClick={(e) => {
              e.stopPropagation();
            }}
            onChange={(e) => {
              setExpectedOutput(e.target.value);
            }}
          />
        </>
      )}
      {annotations.data?.some(
        (annotation: { expectedOutput?: string | null }) =>
          annotation.expectedOutput
      ) && (
        <>
          <Text fontWeight="bold">Expected Output:</Text>
          {annotations.data?.map((annotation) => {
            if (annotation.expectedOutput) {
              return (
                <>
                  <HStack width="full" key={annotation.id}>
                    <Avatar.Root size="xs">
                      <Avatar.Fallback name={annotation.user?.name ?? ""} />
                    </Avatar.Root>

                    {commentState.expectedOutputAction === "edit" &&
                    annotationId === annotation.id ? (
                      <Textarea
                        value={
                          commentState.expectedOutputAction === "edit"
                            ? expectedOutput ?? ""
                            : annotation.expectedOutput ?? ""
                        }
                        placeholder="Enter your expected output here..."
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                        onChange={(e) => {
                          setExpectedOutput(e.target.value);
                        }}
                      />
                    ) : (
                      <Text>{annotation.expectedOutput}</Text>
                    )}
                  </HStack>
                </>
              );
            }

            return null;
          })}
        </>
      )}
    </VStack>
  );
};
