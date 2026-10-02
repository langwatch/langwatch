/**
 * Turn separator for the playground: a hairline with "TURN N" centred. Once
 * the turn's trace has landed it grows a "View trace" affordance — until
 * then a plain rule, since a trace that 404s is worse than a beat's wait.
 */

import { Box, Flex, HStack, Icon, Text } from "@langwatch/design-system/primitives";
import { LuListTree } from "react-icons/lu";

import { usePlaygroundTrace } from "../../../../behavior/use-playground-trace.ts";
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
  const host = usePromptHost();

  const traceQuery = usePlaygroundTrace({ traceId, live });
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
