/**
 * One stored widget on a board: its name, info tip and menu over the widget's sandboxed
 * frame, drawn over the board's period and grain. The drag handle shows on hover
 * or focus. Edit opens the shared in-place editor on the widget's code and queries.
 */

import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { GripVertical } from "lucide-react";
import { useMemo, useState } from "react";

import type { DashboardWidgetDraft } from "../../../../model/dashboard-widget-definition.ts";
import { CHART_GRID_DRAG_HANDLE_CLASS } from "../../../../ui/sections/chart-grid.tsx";
import { DashboardWidgetFrameOverWindow } from "../../../../ui/sections/dashboard-widget-frame.tsx";
import { DashboardWidgetInPlaceEditor } from "../../../../ui/sections/dashboard-widget-in-place-editor.tsx";
import { boardCardHeightPx } from "../../model/board-grid.ts";
import type { BoardPeriod } from "../../model/board-period.ts";
import type { BoardWidget } from "../../model/board-widgets.ts";
import { WidgetInfoTip } from "../blocks/widget-info-tip.tsx";
import { WidgetMenu } from "../blocks/widget-menu.tsx";

/** The title row's height: its top padding and one 13px line. */
const HEADER_HEIGHT_PX = 33;
/** The room the title row, the frame's bottom padding and the border take from the frame. */
const CARD_CHROME_PX = HEADER_HEIGHT_PX + 8 + 2;

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
      className="group"
      position="relative"
      align="stretch"
      gap={0}
      height="full"
      minWidth={0}
      overflow="hidden"
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      background="bg.panel"
      boxShadow="0 1px 2px rgb(16 16 32 / 0.04)"
    >
      <Text
        height={`${HEADER_HEIGHT_PX}px`}
        paddingTop="14px"
        paddingLeft={4}
        paddingRight={widget.definition.description ? 22 : 16}
        truncate
        fontSize="13px"
        lineHeight="19px"
        fontWeight="medium"
      >
        {widget.name}
      </Text>
      <HStack position="absolute" top="13px" right={4} gap={0}>
        <Box
          className={CHART_GRID_DRAG_HANDLE_CLASS}
          cursor="grab"
          color="gray.400"
          padding={1}
          title="Drag to move"
          opacity={0}
          transition="opacity 0.15s"
          _groupHover={{ opacity: 1 }}
          _groupFocusWithin={{ opacity: 1 }}
        >
          <GripVertical size={14} aria-hidden />
        </Box>
        {widget.definition.description && (
          <WidgetInfoTip name={widget.name} description={widget.definition.description} />
        )}
        <WidgetMenu
          name={widget.name}
          disabled={isWriting}
          onEdit={() => setIsEditing(true)}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      </HStack>
      <Box flex={1} minHeight={0} paddingX={2} paddingBottom={2}>
        <DashboardWidgetFrameOverWindow
          id={widget.id}
          graph={widget.definition}
          projectId={projectId}
          projectSlug={projectSlug}
          dashboardId={dashboardId}
          widgetName={widget.name}
          maxHeight={Math.max(boardCardHeightPx(widget.placement.rowSpan) - CARD_CHROME_PX, 60)}
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
