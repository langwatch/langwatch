/**
 * Turn separator line for the run detail conversation, matching the
 * Traces V2 conversation view: a hairline with "TURN N" centered. When the
 * turn's trace has landed, the separator grows a "View trace" affordance —
 * hover previews the trace, click opens the trace drawer.
 */

import { Box, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { LuListTree } from "react-icons/lu";
import { TRACE_QUERY_CONFIG } from "../copilot-kit/trace-message";
import { TracePreviewHoverCard } from "@langwatch/trace-web/explorer/components/TraceIdPeek";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project";
import { useTraceDetailsDrawer } from "../../../behavior/use-trace-details-drawer";
import { api } from "../../../behavior/scenario-api";

/**
 * The line reads solid where it meets the label at the centre and fades to
 * nothing at the outer edge, so a wall of turns reads as one column of labels
 * instead of a ladder of rules.
 */
function SeparatorLine({ side }: { side: "left" | "right" }) {
  const fadeTo =
    side === "left"
      ? "linear-gradient(to left, var(--turn-line-color, var(--chakra-colors-border-muted)), transparent)"
      : "linear-gradient(to right, var(--turn-line-color, var(--chakra-colors-border-muted)), transparent)";
  return (
    <Box
      className="turn-line"
      height="1px"
      flex={1}
      bgImage={fadeTo}
      transition="background 0.12s ease"
    />
  );
}

function SeparatorLabel({ index, hasTrace }: { index: number; hasTrace: boolean }) {
  return (
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
  );
}

export function RunTurnSeparator({ index, traceId }: { index: number; traceId: string }) {
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
      onClick={hasTrace ? () => openTraceDetailsDrawer({ traceId }) : undefined}
      onKeyDown={
        hasTrace
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openTraceDetailsDrawer({ traceId });
              }
            }
          : undefined
      }
      _hover={
        hasTrace
          ? {
              "--turn-line-color": "var(--chakra-colors-border-emphasized)",
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
              "--turn-line-color": "var(--chakra-colors-border-emphasized)",
              "& .turn-view-trace": { color: "fg.muted" },
            }
          : undefined
      }
    >
      <SeparatorLine side="left" />
      <SeparatorLabel index={index} hasTrace={hasTrace} />
      <SeparatorLine side="right" />
    </Flex>
  );

  if (!hasTrace) return separator;
  return <TracePreviewHoverCard traceId={traceId}>{separator}</TracePreviewHoverCard>;
}
