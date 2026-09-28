/**
 * One stored widget on a board: its name, a drag handle and its menu over the
 * widget's sandboxed frame, drawn over the board's period and grain. Edit
 * opens the shared in-place editor on this widget's own code and queries.
 */

import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { GripVertical } from "lucide-react";
import { useMemo, useState } from "react";

import { chartGridCardHeightPx } from "../../../../model/chart-grid.ts";
import type { DashboardWidgetDraft } from "../../../../model/dashboard-widget-definition.ts";
import { CHART_GRID_DRAG_HANDLE_CLASS } from "../../../../ui/sections/chart-grid.tsx";
import { DashboardWidgetFrameOverWindow } from "../../../../ui/sections/dashboard-widget-frame.tsx";
import { DashboardWidgetInPlaceEditor } from "../../../../ui/sections/dashboard-widget-in-place-editor.tsx";
import type { BoardPeriod } from "../../model/board-period.ts";
import type { BoardWidget } from "../../model/board-widgets.ts";
import { WidgetMenu } from "../blocks/widget-menu.tsx";

/** The room the header row and the card's padding take from the widget's frame. */
const CARD_CHROME_PX = 56;

export function BoardWidgetCard({
  widget,
  projectId,
  projectSlug,
  dashboardId,
  period,
  isWriting,
  isSaving,
  onDuplicate,
  onDelete,
  onSave,
}: {
  widget: BoardWidget;
  projectId: string;
  projectSlug: string;
  dashboardId: string;
  period: BoardPeriod;
  isWriting: boolean;
  isSaving: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  onSave: (input: { draft: DashboardWidgetDraft; onSaved: () => void }) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const { periodStart, periodEnd, granularitySeconds } = period;
  const timeWindow = useMemo(
    () => ({ start: periodStart, end: periodEnd }),
    [periodStart, periodEnd],
  );
  const draft: DashboardWidgetDraft = {
    name: widget.name,
    code: widget.definition.code,
    queries: widget.definition.queries,
  };

  return (
    <VStack
      align="stretch"
      gap={2}
      height="full"
      minWidth={0}
      overflow="hidden"
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      background="bg.panel"
      boxShadow="0 1px 2px rgb(16 16 32 / 0.04)"
      paddingX={4}
      paddingTop={2.5}
      paddingBottom={3}
    >
      <HStack gap={1}>
        <Text flex={1} minWidth={0} truncate fontSize="13px" fontWeight="semibold">
          {widget.name}
        </Text>
        <Box
          className={CHART_GRID_DRAG_HANDLE_CLASS}
          cursor="grab"
          color="gray.400"
          padding={1}
          title="Drag to move"
        >
          <GripVertical size={14} aria-hidden />
        </Box>
        <WidgetMenu
          name={widget.name}
          disabled={isWriting}
          onEdit={() => setIsEditing(true)}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      </HStack>
      <Box flex={1} minHeight={0}>
        <DashboardWidgetFrameOverWindow
          id={widget.id}
          graph={widget.definition}
          projectId={projectId}
          projectSlug={projectSlug}
          dashboardId={dashboardId}
          widgetName={widget.name}
          maxHeight={Math.max(chartGridCardHeightPx(widget.placement.rowSpan) - CARD_CHROME_PX, 60)}
          timeWindow={timeWindow}
          granularitySeconds={granularitySeconds}
        />
      </Box>
      <DashboardWidgetInPlaceEditor
        open={isEditing}
        id={widget.id}
        widget={draft}
        projectId={projectId}
        projectSlug={projectSlug}
        timeWindow={timeWindow}
        granularitySeconds={granularitySeconds}
        isSaving={isSaving}
        onClose={() => setIsEditing(false)}
        onSave={({ draft: edited, onSuccess }) => onSave({ draft: edited, onSaved: onSuccess })}
      />
    </VStack>
  );
}
