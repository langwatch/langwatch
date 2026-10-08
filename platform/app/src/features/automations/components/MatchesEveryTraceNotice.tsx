import { HStack, Text } from "@chakra-ui/react";
import { AlertTriangle } from "react-feather";
import { Tooltip } from "~/components/ui/tooltip";

export const MATCHES_EVERY_TRACE_EXPLANATION =
  "This automation has no condition, so it acts on every incoming trace. Edit it to add a condition, or pause it.";

/** The warning an automation with no condition shows wherever its
 *  conditions would: it looks harmless, but it matches every trace. */
export function MatchesEveryTraceNotice() {
  return (
    <Tooltip content={MATCHES_EVERY_TRACE_EXPLANATION}>
      <HStack
        gap={1.5}
        color="orange.fg"
        width="fit-content"
        tabIndex={0}
        data-testid="matches-every-trace"
      >
        <AlertTriangle size={14} aria-hidden="true" />
        <Text textStyle="sm" fontWeight="medium">
          Matches every trace
        </Text>
      </HStack>
    </Tooltip>
  );
}
