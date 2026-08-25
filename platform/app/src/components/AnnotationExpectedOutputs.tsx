import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { annotationSuggestedOutput } from "@langwatch/annotation-contract";
import { useState } from "react";
import { UserAvatar } from "~/components/UserAvatar";
import { Tooltip } from "~/components/ui/tooltip";
import { AnnotationPopover } from "~/features/traces-v2/components/TraceDrawer/conversationView/AnnotationPopover";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

/**
 * The corrections already suggested for a trace, listed under the message they
 * correct. Picking one reopens it in the same correction popover the trace
 * drawer uses, so a suggestion is written in exactly one place.
 */
export const AnnotationExpectedOutputs = ({
  traceId,
  output,
}: {
  traceId: string;
  output: string;
}) => {
  const { project } = useOrganizationTeamProject();
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);

  const annotations = api.annotation.getByTraceId.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: traceId,
    },
    {
      enabled: !!project?.id,
    },
  );

  const suggestions = (annotations.data ?? []).filter((annotation) =>
    annotationSuggestedOutput({ annotation, traceId }),
  );

  if (suggestions.length === 0) return null;

  return (
    <VStack gap={3} align="start" paddingBottom={4} width="full">
      <Text fontWeight="bold">Suggested output</Text>
      {suggestions.map((annotation) => (
        <HStack width="full" key={annotation.id} align="start" gap={2}>
          <Tooltip content={annotation.user?.name ?? ""}>
            <Box display="inline-flex">
              <UserAvatar
                size="xs"
                name={annotation.user?.name ?? ""}
                image={annotation.user?.image}
              />
            </Box>
          </Tooltip>
          {/* The suggestion itself opens the popover, so closing it hands the
              keyboard back to the line the reviewer came from. */}
          <AnnotationPopover
            traceId={traceId}
            output={output}
            mode="suggest"
            annotationId={annotation.id}
            open={editingAnnotationId === annotation.id}
            onOpenChange={(open) => setEditingAnnotationId(open ? annotation.id : null)}
            trigger={
              <Box
                as="button"
                textAlign="left"
                cursor="pointer"
                onClick={(event: React.MouseEvent) => event.stopPropagation()}
              >
                <Text>{annotation.expectedOutput}</Text>
              </Box>
            }
          />
        </HStack>
      ))}
    </VStack>
  );
};
