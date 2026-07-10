/**
 * Turn separator line for the run detail conversation, matching the
 * Traces V2 conversation view: a hairline with "TURN N" centered. When the
 * turn's trace has landed, the separator grows a "View trace" affordance —
 * hover previews the trace, click opens the trace drawer.
 */

import { Box, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { LuListTree } from "react-icons/lu";
import { TRACE_QUERY_CONFIG } from "~/components/copilot-kit/TraceMessage";
import { TracePreviewHoverCard } from "~/features/traces-v2/components/TraceIdPeek";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useTraceDetailsDrawer } from "~/hooks/useTraceDetailsDrawer";
import { api } from "~/utils/api";

export function RunTurnSeparator({
  index,
  traceId,
}: {
  index: number;
  traceId: string;
}) {
  const { project } = useOrganizationTeamProject();
  const { openTraceDetailsDrawer } = useTraceDetailsDrawer();

  // Same guarded fetch the old View Trace button used: traces land a beat
  // after the message snapshot, so retry quietly and only advertise the
  // affordance once the trace actually exists.
  const traceQuery = api.traces.getById.useQuery(
    { projectId: project?.id ?? "", traceId },
    {
      enabled: !!project && !!traceId,
      ...TRACE_QUERY_CONFIG,
    },
  );
  const hasTrace = !!traceQuery.data;

  const separator = (
    <Flex
      align="center"
      gap={2}
      width="100%"
      role={hasTrace ? "button" : undefined}
      aria-label={hasTrace ? `View trace for turn ${index}` : undefined}
      tabIndex={hasTrace ? 0 : undefined}
      cursor={hasTrace ? "pointer" : "default"}
      onClick={
        hasTrace
          ? () => openTraceDetailsDrawer({ traceId, selectedTab: "traceDetails" })
          : undefined
      }
      onKeyDown={
        hasTrace
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openTraceDetailsDrawer({ traceId, selectedTab: "traceDetails" });
              }
            }
          : undefined
      }
      _hover={
        hasTrace
          ? {
              "& .turn-line": { bg: "border.emphasized" },
              "& .turn-view-trace": { color: "fg.muted" },
            }
          : undefined
      }
      _focusVisible={
        hasTrace
          ? {
              outline: "2px solid",
              outlineColor: "border.emphasized",
              outlineOffset: "2px",
              borderRadius: "sm",
              "& .turn-line": { bg: "border.emphasized" },
              "& .turn-view-trace": { color: "fg.muted" },
            }
          : undefined
      }
    >
      <Box
        className="turn-line"
        height="1px"
        flex={1}
        bg="border.muted"
        transition="background 0.12s ease"
      />
      <HStack gap={1.5} flexShrink={0}>
        <Text
          textStyle="2xs"
          fontWeight="600"
          textTransform="uppercase"
          letterSpacing="0.06em"
          color="fg.subtle"
        >
          Turn {index}
        </Text>
        {hasTrace && (
          <>
            <Text textStyle="2xs" color="fg.subtle">
              ·
            </Text>
            <HStack
              className="turn-view-trace"
              gap={1}
              color="fg.subtle"
              transition="color 0.12s ease"
            >
              <Icon as={LuListTree} boxSize={3} />
              <Text textStyle="2xs" fontWeight="500">
                View trace
              </Text>
            </HStack>
          </>
        )}
      </HStack>
      <Box
        className="turn-line"
        height="1px"
        flex={1}
        bg="border.muted"
        transition="background 0.12s ease"
      />
    </Flex>
  );

  if (!hasTrace) return separator;
  return (
    <TracePreviewHoverCard traceId={traceId}>{separator}</TracePreviewHoverCard>
  );
}
