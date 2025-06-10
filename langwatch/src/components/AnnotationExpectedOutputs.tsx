import { Avatar, HStack, Text, Textarea, VStack } from "@chakra-ui/react";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useAnnotationCommentStore } from "../hooks/useAnnotationCommentStore";
import { useEffect, useState } from "react";

export const AnnotationExpectedOutputs = ({
  traceId,
}: {
  traceId: string;
  setHover: (hover: boolean) => void;
  output: string;
}) => {
  const { project } = useOrganizationTeamProject();
  const commentState = useAnnotationCommentStore();

  const { annotationId, expectedOutput, setExpectedOutput, setCommentState } =
    commentState;

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
    <VStack gap={3} align="start" paddingBottom={4} width="full">
      {commentState.expectedOutputAction === "new" &&
        traceId === commentState.traceId && (
          <>
            <Text fontWeight="500">Suggest output:</Text>
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
                  <HStack
                    width="full"
                    key={annotation.id}
                    onDoubleClick={() => {
                      setCommentState({
                        expectedOutputAction: "edit",
                        annotationId: annotation.id,
                        expectedOutput: annotation.expectedOutput,
                        traceId: traceId,
                        action: "edit",
                      });
                    }}
                  >
                    <Avatar.Root size="xs">
                      <Tooltip content={annotation.user?.name ?? ""}>
                        <Avatar.Fallback name={annotation.user?.name ?? ""} />
                      </Tooltip>
                    </Avatar.Root>

                    {commentState.expectedOutputAction === "edit" &&
                    annotationId === annotation.id ? (
                      <Textarea
                        backgroundColor="white"
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
