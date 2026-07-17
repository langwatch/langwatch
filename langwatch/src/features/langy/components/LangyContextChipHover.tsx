import { Box, Text, VStack } from "@chakra-ui/react";
import type { ReactElement } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { describeChipContext } from "../logic/langyChipContext";
import { shortenChipId } from "../logic/langyContextChips";
import type { LangyContextChip } from "../stores/langyStore";
import { useResolvedTraceName } from "./langyTraceName";

/**
 * What a context chip is handing to Langy, on hover — named for a human, with
 * the raw id kept as secondary detail.
 *
 * A chip's label says what it IS; its `ref` says what actually travels. For a
 * trace that ref is a raw id, which tells the person nothing. So the hover LEADS
 * with a human-friendly name (the trace summary / first message / endpoint /
 * model the app already resolves), states what Langy will do with the chip, and
 * only then shows the raw id underneath — recognisable when you need it, never
 * the headline.
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

  // Only trace chips carry a raw id worth translating, and only when the label
  // IS that id (a route-derived chip). A chip that already arrived with a human
  // name — the trace table / drawer pass one — skips the summary-heavy fetch.
  const isTrace = chip.kind === "trace";
  const labelIsBareId =
    isTrace && !!chip.ref && chip.label.includes(shortenChipId(chip.ref));
  const resolvedTraceName = useResolvedTraceName(
    isTrace ? chip.ref : undefined,
    {
      enabled: labelIsBareId,
    },
  );

  const heading = resolvedTraceName ?? chip.label;
  // Caption the secondary line by what the payload actually is, so "Trace ID"
  // reads as the id and a filter/selection reads as its query.
  const payloadCaption = isTrace ? "Trace ID" : null;

  return (
    <Tooltip
      openDelay={200}
      closeDelay={80}
      positioning={{ placement: "top" }}
      content={
        <VStack align="start" gap={1.5} maxWidth="280px">
          <Text
            textStyle="xs"
            fontWeight="semibold"
            lineHeight="1.35"
            wordBreak="break-word"
          >
            {heading}
          </Text>
          <Text textStyle="2xs" color="fg.muted" lineHeight="1.45">
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
              {payloadCaption ? (
                <Text
                  textStyle="2xs"
                  color="fg.subtle"
                  textTransform="uppercase"
                  letterSpacing="0.04em"
                  marginBottom="2px"
                >
                  {payloadCaption}
                </Text>
              ) : null}
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
