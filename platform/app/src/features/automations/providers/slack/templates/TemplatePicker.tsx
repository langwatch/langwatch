import { Box, Flex, Stack, Text } from "@chakra-ui/react";
import type { SlackDeliveryMethod } from "@langwatch/automations/providers/slack";
import { useEffect, useRef, useState } from "react";
import {
  buildLayoutGroups,
  type LayoutRow,
  otherCadenceOf,
} from "./layoutRows";
import {
  type DraftCadence,
  pickDefaultSlackBlockKitTemplateId,
  type ReportTemplateSource,
  type SlackBlockKitTemplateId,
  type SlackBlockKitTemplateKind,
  type SlackBlockKitTemplateOption,
} from "./registry";
import { TemplateLayoutDetail } from "./TemplateLayoutDetail";
import { TemplateLayoutList } from "./TemplateLayoutList";

interface Props {
  cadence: DraftCadence;
  /** Trace automations and graph alerts render against different variable
   *  sets, so the picker only offers layouts built for the draft's kind. */
  kind: SlackBlockKitTemplateKind;
  /** For a report: what it sends. Only layouts that can render that source's
   *  data are offered — a chart layout has nothing to plot for a trace-query
   *  report. A dashboard needs no layout at all, so the form owner does not
   *  render the picker for it. */
  reportSource?: ReportTemplateSource;
  /** The chosen delivery method. Templates that lead with a modern block
   *  (`gatedBlock`) render in full only on a bot connection, so on a webhook
   *  they show but can't be picked. */
  deliveryMethod: SlackDeliveryMethod;
  hasEvaluationFilter: boolean;
  /** The current value of slice.template — used to highlight which preset
   *  (if any) matches it. Custom edits highlight nothing. */
  currentSource: string;
  onSelect: (option: SlackBlockKitTemplateOption) => void;
  /** Picking a layout built for the other cadence. The form owner switches
   *  the cadence alongside the template so the author doesn't have to make
   *  the round-trip to the cadence stage. */
  onSelectOtherCadence: (option: SlackBlockKitTemplateOption) => void;
}

function introFor({
  kind,
  reportSource,
}: Pick<Props, "kind" | "reportSource">): string {
  if (kind === "report") {
    return reportSource === "customGraph"
      ? "Your report sends a graph, so every layout plots it. The preview shows structure, not the final look."
      : "Your report sends the traces that match, so every layout lists them. The preview shows structure, not the final look.";
  }
  if (kind === "graphAlert") {
    return "Each layout sends one message when the automation fires. The preview shows structure, not the final look.";
  }
  return "Pick a starting layout. The preview shows structure, not the final look.";
}

export function SlackBlockKitTemplatePicker({
  cadence,
  kind,
  reportSource,
  deliveryMethod,
  hasEvaluationFilter,
  currentSource,
  onSelect,
  onSelectOtherCadence,
}: Props) {
  // The grouping (which cadence's layouts lead the list, and which follow
  // under the other heading) is latched to the cadence the picker last
  // settled on. Picking a cross-cadence layout changes the draft's cadence —
  // see `onSelectOtherCadence` below — and that change flows back down as a
  // new `cadence` prop. Deriving the grouping from the live prop on every
  // render would swap the two groups on every cross-cadence pick: the group
  // the author just scrolled to jumps to the top and the layout they were
  // looking at moves out from under them. Selecting still updates the
  // highlight and the draft's cadence — it just never reorders the list AS A
  // RESULT OF THAT PICK.
  //
  // The picker is opened from the Delivery step, whose cadence control sits
  // beside the channel it belongs to (ADR-093 §4), so the author can change
  // cadence there while this picker stays mounted. That external change must
  // still regroup the list — `groupingCadence` exists to survive an in-picker
  // pick, not to pin the picker to whatever cadence happened to be active
  // when it first mounted. `selfInitiatedRef` marks the cadence value
  // `handleApply` itself is about to cause, so the effect below can tell "I
  // changed it" apart from "it changed elsewhere" and only resync for the
  // latter.
  const [groupingCadence, setGroupingCadence] = useState<DraftCadence>(cadence);
  const selfInitiatedRef = useRef<DraftCadence | null>(null);
  useEffect(() => {
    if (cadence === groupingCadence) return;
    if (selfInitiatedRef.current === cadence) {
      selfInitiatedRef.current = null;
      return;
    }
    setGroupingCadence(cadence);
  }, [cadence, groupingCadence]);

  const groups = buildLayoutGroups({
    groupingCadence,
    kind,
    reportSource,
    deliveryMethod,
    currentSource,
    defaultId: pickDefaultSlackBlockKitTemplateId({
      cadence,
      hasEvaluationFilter,
      kind,
      reportSource,
    }),
  });
  const rows = groups.flatMap((group) => group.rows);
  const [highlightedId, setHighlightedId] =
    useState<SlackBlockKitTemplateId | null>(null);
  // What the preview pane shows: the layout the author last landed on, and
  // before they have touched anything, the one the draft already uses. A
  // custom-edited message matches no layout, so the preview opens on the
  // default instead of on nothing.
  const highlighted =
    rows.find((row) => row.option.id === highlightedId) ??
    rows.find((row) => row.isSelected) ??
    rows.find((row) => row.isDefault) ??
    rows[0];

  const handleApply = (row: LayoutRow) => {
    if (!row.fromOtherCadence) {
      onSelect(row.option);
      return;
    }
    const target = otherCadenceOf(groupingCadence);
    // A pick that lands on the SAME cadence as the live prop (two
    // consecutive picks within the other-cadence group, comparison-shopping
    // between its layouts) never flips `cadence`, so the resync effect above
    // never fires and never consumes the marker. Writing it anyway would
    // leave it stale — a LATER, genuine external change that happens to land
    // back on this same cadence value would then be misread as self-initiated
    // and skip its regroup. Only write the marker when the pick actually
    // changes the live cadence.
    if (target !== cadence) selfInitiatedRef.current = target;
    onSelectOtherCadence(row.option);
  };

  return (
    <Stack gap={3} align="stretch">
      <Text textStyle="xs" color="fg.muted">
        {introFor({ kind, reportSource })}
      </Text>
      <Flex gap={4} align="start" wrap="wrap">
        <Box flex="1 1 190px" minWidth="190px">
          <TemplateLayoutList
            groups={groups}
            highlightedId={highlighted?.option.id}
            onHighlight={setHighlightedId}
            onApply={handleApply}
          />
        </Box>
        <Box flex="2 1 280px" minWidth="260px">
          {highlighted ? (
            <TemplateLayoutDetail
              row={highlighted}
              switchesCadenceTo={
                highlighted.fromOtherCadence
                  ? otherCadenceOf(groupingCadence)
                  : undefined
              }
            />
          ) : null}
        </Box>
      </Flex>
    </Stack>
  );
}
