import type { SlackDeliveryMethod } from "@langwatch/automation-contract";
import { Box, Flex, Stack, Text } from "@langwatch/design-system/primitives";
import { useId, useState } from "react";

import { buildLayoutRows, type LayoutRow } from "../elements/layout-rows.ts";
import {
  type DraftCadence,
  pickDefaultSlackBlockKitTemplateId,
  type ReportTemplateSource,
  type SlackBlockKitTemplateId,
  type SlackBlockKitTemplateKind,
  type SlackBlockKitTemplateOption,
} from "../elements/registry.ts";
import { TemplateLayoutDetail } from "./template-layout-detail.tsx";
import { TemplateLayoutList } from "./template-layout-list.tsx";

interface Props {
  /** The draft's live cadence. The receive chooser above this picker is the
   *  one cadence control; the list only ever offers the layouts built for
   *  this value and re-filters when it changes. */
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
}

function introFor({ kind, reportSource }: Pick<Props, "kind" | "reportSource">): string {
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
}: Props) {
  const previewId = useId();
  const rows = buildLayoutRows({
    cadence,
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
  const [highlightedId, setHighlightedId] = useState<SlackBlockKitTemplateId | undefined>(
    undefined,
  );
  // The preview shows the layout last landed on, else the one the draft uses, else the
  // default. A custom message or a cadence switch that drops the highlighted layout falls
  // through the same chain to a layout that is actually offered.
  const highlighted =
    rows.find((row) => row.option.id === highlightedId) ??
    rows.find((row) => row.isSelected) ??
    rows.find((row) => row.isDefault) ??
    rows[0];

  const handleApply = (row: LayoutRow) => {
    onSelect(row.option);
  };

  return (
    <Stack gap={3} align="stretch">
      <Text textStyle="xs" color="fg.muted">
        {introFor({ kind, reportSource })}
      </Text>
      <Flex gap={4} align="start" wrap="wrap">
        <Box flex="1 1 190px" minWidth="190px">
          <TemplateLayoutList
            rows={rows}
            highlightedId={highlighted?.option.id}
            previewId={previewId}
            onHighlight={setHighlightedId}
            onApply={handleApply}
          />
        </Box>
        <Box flex="2 1 280px" minWidth="260px">
          {highlighted ? <TemplateLayoutDetail row={highlighted} id={previewId} /> : null}
        </Box>
      </Flex>
    </Stack>
  );
}
