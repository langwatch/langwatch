/**
 * One stored widget on a board: its name and a faint info tip, then the drag handle, Ask Langy
 * and menu, which show only on hover or focus so a board of cards stays calm. Drawn over the
 * board's period and grain; Edit opens the shared in-place editor on its code and queries.
 */

import { Box, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { GripVertical } from "lucide-react";
import { useMemo, useState } from "react";

import type { DashboardWidgetDraft } from "../../../../model/dashboard-widget-definition.ts";
import { CHART_GRID_DRAG_HANDLE_CLASS } from "../../../../ui/sections/chart-grid.tsx";
import { DashboardWidgetFrameOverWindow } from "../../../../ui/sections/dashboard-widget-frame.tsx";
import { DashboardWidgetInPlaceEditor } from "../../../../ui/sections/dashboard-widget-in-place-editor.tsx";
import type { WidgetSetup } from "../../langy/model/board-langy.ts";
import { boardCardHeightPx } from "../../model/board-grid.ts";
import type { BoardPeriod } from "../../model/board-period.ts";
import type { BoardWidget } from "../../model/board-widgets.ts";
import { AskLangyButton } from "../blocks/ask-langy-button.tsx";
import { WidgetInfoTip } from "../blocks/widget-info-tip.tsx";
import { WidgetMenu } from "../blocks/widget-menu.tsx";

/** The title row's height: its top padding and one 24px row of controls. */
const HEADER_HEIGHT_PX = 34;
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
  onAskLangy,
  onSetUp,
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
  /** Drafts this widget's prompt in Langy; absent when Langy is not available. */
  onAskLangy?: () => void;
  /** Drafts an alert or report on this widget in Langy; absent when Langy is not available. */
  onSetUp?: (setup: WidgetSetup) => void;
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
      <HStack
        height={`${HEADER_HEIGHT_PX}px`}
        paddingTop="10px"
        paddingLeft={4}
        paddingRight={2}
        gap={1}
      >
        <Text minWidth={0} truncate fontSize="13px" lineHeight="20px" fontWeight="medium">
          {widget.name}
        </Text>
        {widget.definition.description && (
          <WidgetInfoTip name={widget.name} description={widget.definition.description} />
        )}
        <HStack
          gap={0.5}
          marginLeft="auto"
          flexShrink={0}
          opacity={0}
          transition="opacity 0.15s"
          _groupHover={{ opacity: 1 }}
          _groupFocusWithin={{ opacity: 1 }}
          css={{
            // An open menu moves focus out of the card; keep its trigger in view meanwhile.
            "&:has([aria-expanded=true])": { opacity: 1 },
            "@media (hover: none)": { opacity: 1 },
          }}
        >
          <Box
            className={CHART_GRID_DRAG_HANDLE_CLASS}
            display="flex"
            alignItems="center"
            justifyContent="center"
            boxSize={6}
            borderRadius="md"
            cursor="grab"
            color="fg.subtle"
            title="Drag to move"
            _hover={{ color: "fg", background: "bg.muted" }}
          >
            <GripVertical size={14} aria-hidden />
          </Box>
          {onAskLangy && <AskLangyButton name={widget.name} onClick={onAskLangy} />}
          <WidgetMenu
            name={widget.name}
            disabled={isWriting}
            onEdit={() => setIsEditing(true)}
            onDuplicate={onDuplicate}
            onSetAlert={onSetUp && (() => onSetUp("alert"))}
            onSendReport={onSetUp && (() => onSetUp("report"))}
            onDelete={onDelete}
          />
        </HStack>
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
