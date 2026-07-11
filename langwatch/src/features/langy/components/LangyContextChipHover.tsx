import { Box, Text, VStack } from "@chakra-ui/react";
import type { ReactElement } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { describeChipContext } from "../logic/langyChipContext";
import type { LangyContextChip } from "../stores/langyStore";

/**
 * What a context chip is handing to Langy, on hover.
 *
 * A chip's label says what it IS ("filtered: status:error"). It never said what
 * it DOES, and for a search that gap hides a real fork in behaviour: does Langy
 * receive the query, or the rows the query matched? This answers that, per chip,
 * in one sentence, and then shows the concrete payload underneath it so the
 * answer can be checked rather than trusted.
 *
 * The payload is read straight off the chip's `ref` (see `describeChipContext`),
 * which is the field that actually rides to the server. A hover that described
 * anything else would be describing a fiction sitting next to the truth.
 *
 * Wrap the chip:
 *
 *   <LangyContextChipHover chip={chip}>
 *     <ContextChip … />
 *   </LangyContextChipHover>
 */
export function LangyContextChipHover({
  chip,
  children,
}: {
  chip: LangyContextChip;
  children: ReactElement;
}) {
  const { action, payload } = describeChipContext(chip);

  return (
    <Tooltip
      openDelay={200}
      closeDelay={80}
      positioning={{ placement: "top" }}
      content={
        <VStack align="start" gap={1.5} maxWidth="260px">
          <Text textStyle="xs" lineHeight="1.45">
            {action}
          </Text>
          {payload ? (
            // The literal payload, in mono, because it is an id or a search and
            // the user needs to recognise it, not read it as prose.
            <Box
              width="full"
              paddingX={1.5}
              paddingY={1}
              borderRadius="sm"
              background="bg.muted"
            >
              <Text
                textStyle="2xs"
                fontFamily="mono"
                color="fg.muted"
                wordBreak="break-all"
              >
                {payload}
              </Text>
            </Box>
          ) : null}
        </VStack>
      }
    >
      {children}
    </Tooltip>
  );
}
