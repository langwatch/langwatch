/**
 * Turn separator for the playground's conversation: a hairline with "TURN N"
 * centred.
 *
 * When the turn's trace has landed the separator grows a "View trace"
 * affordance - clicking it opens the trace drawer. Until then it stays a plain
 * rule, because advertising a trace that 404s is worse than waiting a beat for
 * one that opens.
 *
 * The hover-peek popover the trace drawer's own separator carries does not
 * travel: it is application internals a feature package may not reach. Same
 * recorded gap the deleted `trace-message.tsx` carried.
 */

import { Box, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { TRACE_QUERY_CONFIG } from "@langwatch/trace-web/surfaces/conversation";
import { LuListTree } from "react-icons/lu";

import { promptApi } from "../../../../behavior/prompt-api.ts";
import { usePromptProject } from "../../../../behavior/use-prompt-project.ts";
import { usePromptHost } from "../../../../model/prompt-host.ts";

function SeparatorLine() {
  return (
    <Box
      className="turn-line"
      height="1px"
      flex={1}
      bg="border.muted"
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

export function PlaygroundTurnSeparator({
  index,
  traceId,
  live = false,
}: {
  index: number;
  /**
   * Absent until the run that produced this turn has been traced. The turn is
   * numbered either way - the exchange exists from the moment it is sent - and
   * only the affordance waits for somewhere to go.
   */
  traceId?: string;
  /**
   * The turn is happening now, so its trace is still on its way. Off for a
   * replayed transcript, where a trace that is not there is not coming.
   */
  live?: boolean;
}) {
  const { project } = usePromptProject();
  const host = usePromptHost();

  // Traces land a beat after the message snapshot, so retry quietly and only
  // advertise the affordance once the trace actually exists.
  const traceQuery = promptApi.traces.getById.useQuery(
    { projectId: project?.id ?? "", traceId: traceId ?? "" },
    {
      enabled: !!project && !!traceId,
      ...TRACE_QUERY_CONFIG,
      // Each separator opens its own query, so a transcript of N turns holds N
      // of them. Waiting out ten minute-spaced retries per turn is only worth
      // it while the trace might still land; on a replay it is a retry tail for
      // a trace that already does not exist.
      retry: live ? TRACE_QUERY_CONFIG.retry : 0,
    },
  );
  // One value carries both facts the render needs: that a trace exists, and
  // which one - so the click handler cannot be built without an id to open.
  const linkedTraceId = traceQuery.data && traceId ? traceId : undefined;
  const hasTrace = !!linkedTraceId;

  const open = () => {
    if (!linkedTraceId) return;
    host.openPlatformDrawer({ drawer: "traceV2Details", params: { traceId: linkedTraceId } });
  };

  return (
    <Flex
      align="center"
      gap={2}
      width="100%"
      // Room above, none below: the separator belongs to the exchange it opens,
      // so it reads as attached to what follows it rather than floating equally
      // between two turns.
      paddingTop={4}
      role={hasTrace ? "button" : undefined}
      aria-label={hasTrace ? `View trace for turn ${index}` : undefined}
      tabIndex={hasTrace ? 0 : undefined}
      cursor={hasTrace ? "pointer" : "default"}
      onClick={hasTrace ? open : undefined}
      onKeyDown={
        hasTrace
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                open();
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
      <SeparatorLine />
      <SeparatorLabel index={index} hasTrace={hasTrace} />
      <SeparatorLine />
    </Flex>
  );
}
