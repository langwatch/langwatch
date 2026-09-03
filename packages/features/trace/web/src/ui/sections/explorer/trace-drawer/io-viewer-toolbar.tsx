import { Box, Flex, HStack, Icon } from "@chakra-ui/react";
import { useMemo, useRef } from "react";
import type { TraceAnchor } from "../hooks/use-anchored-annotations";
import { useOverflowVisibility } from "../../../../behavior/explorer/use-overflow-visibility";
import type { useTextTranslation } from "../hooks/use-text-translation";
import { OverflowMenu } from "../../../elements/explorer/shared/overflow-menu";
import { FormatSelect } from "../../../blocks/explorer/trace-drawer/format-select";
import { CopyButton } from "./io-toolbar-buttons";
import { type IOAction, useIOActions } from "./io-actions";
import { formatSelectOptions } from "./io-format-options";
import type { ChatLayout } from "./transcript";
import type { MarkdownSubmode, ViewFormat } from "./use-io-viewer-state";

/**
 * Room held back on the right edge of the actions row for the overflow
 * trigger, which lives inside the measured row. Matches the reserve the
 * viz tab strip uses for the same trigger.
 */
const OVERFLOW_TRIGGER_RESERVE_PX = 26;

/**
 * One action in the row. Collapsed, it keeps its real control mounted at zero
 * width: the overflow menu selects it by clicking that control, so popover
 * wiring and permission gates live in one place.
 */
function IOActionSlot({
  action,
  hidden,
  elementRef,
}: {
  action: IOAction;
  hidden: boolean;
  elementRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <Flex
      data-overflow-id={action.id}
      ref={elementRef}
      align="center"
      flexShrink={0}
      paddingLeft={hidden ? 0 : 2}
      {...(hidden
        ? {
            width: 0,
            minWidth: 0,
            overflow: "hidden",
            visibility: "hidden",
          }
        : {})}
    >
      {action.render()}
    </Flex>
  );
}

/**
 * The measured part of the toolbar: the format selector and the actions,
 * right-aligned, and the three-dot menu holding whichever actions no longer
 * fit.
 *
 * A leading spacer holds everything against the right edge, away from the
 * panel label. The format selector is not something a reader watches, so it
 * belongs with the other controls rather than beside the label, and being
 * first in the group means a longer format name grows leftwards instead of
 * pushing the actions around.
 */
function IOActionsRow({
  actions,
  collapsed,
  formatSelect,
  formatWidthKey,
}: {
  actions: readonly IOAction[];
  collapsed: boolean;
  /** Sits at the head of the right-aligned group, before the actions. */
  formatSelect: React.ReactNode;
  /** Changes whenever `formatSelect` renders at a different width. */
  formatWidthKey: string;
}) {
  // Stable by VALUE, not reference: `actions` rebuilds on unrelated renders
  // (translation state identity churns), and `useOverflowVisibility` resets
  // its measurement whenever the items array changes reference — an unstable
  // array here loops reset → render → reset forever.
  const actionIdsKey = actions.map((a) => a.id).join(" ");
  const actionIds = useMemo(() => actionIdsKey.split(" "), [actionIdsKey]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const actionElsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const hiddenActionIds = useOverflowVisibility({
    scrollerRef,
    items: actionIds,
    reservePx: OVERFLOW_TRIGGER_RESERVE_PX,
    // The selector shares the measured row, so its width is part of what
    // decides how many actions fit. The row itself is flexed and keeps its
    // box either way, so the ResizeObserver reports nothing on a format
    // change and this is what asks for a fresh measurement.
    remeasureKey: formatWidthKey,
  });

  return (
    // Stays mounted while the panel is collapsed so its ResizeObserver keeps
    // watching the same element — going through display:none and back
    // re-measures on its own.
    <HStack
      ref={scrollerRef}
      display={collapsed ? "none" : "flex"}
      flex={1}
      minWidth={0}
      gap={0}
      overflow="hidden"
      flexWrap="nowrap"
      align="center"
    >
      <Box flex={1} minWidth={0} />
      {formatSelect}
      {actions.map((action) => (
        <IOActionSlot
          key={action.id}
          action={action}
          hidden={hiddenActionIds.has(action.id)}
          elementRef={(el) => {
            actionElsRef.current[action.id] = el;
          }}
        />
      ))}
      {/* Inside the measured row, in the slot `reservePx` holds back for it.
          As an outside sibling its mount would shrink the row, the
          ResizeObserver would clear the hidden set, and the trigger would
          unmount and remount on every measurement. */}
      <OverflowMenu
        items={actions
          .filter((action) => hiddenActionIds.has(action.id))
          .map((action) => ({
            id: action.id,
            label: action.menuLabel,
            icon: <Icon as={action.menuIcon} boxSize={3.5} />,
            disabled: action.disabled,
          }))}
        onSelect={(id) => {
          actionElsRef.current[id]?.querySelector<HTMLElement>("button, a")?.click();
        }}
        ariaLabel="More actions"
      />
    </HStack>
  );
}

interface IOViewerToolbarProps {
  /** Names the panel in the format selector's accessible name. */
  label: string;
  /** A collapsed panel shows nothing to format or act on, so only Copy. */
  collapsed: boolean;
  format: ViewFormat;
  onFormatChange: (format: ViewFormat) => void;
  formatOptions: readonly ViewFormat[];
  isChat: boolean;
  chatLayout: ChatLayout;
  onChatLayoutChange: (layout: ChatLayout) => void;
  markdownSubmode: MarkdownSubmode;
  onMarkdownSubmodeChange: (submode: MarkdownSubmode) => void;
  translation: ReturnType<typeof useTextTranslation>;
  traceId: string | undefined;
  spanId: string | undefined;
  spanType: string | undefined;
  mode: "input" | "output";
  /** Which part of the trace an annotation on this panel is about. */
  fieldAnchor: TraceAnchor | null;
  /** The untranslated text, which is what a correction must replace. */
  originalContent: string;
  /** What Copy puts on the clipboard: whatever the panel displays. */
  copyText: string;
}

/**
 * The controls row of an INPUT / OUTPUT panel: one compact format selector,
 * the actions that operate on the field, and Copy, all grouped on the right
 * so the panel label keeps the left to itself.
 *
 * The row keeps one footprint no matter how many actions a panel offers.
 * Actions that no longer fit collapse into the three-dot overflow menu, the
 * same element the span tab strip uses, and Copy stays outside that menu as
 * the last control in the row.
 */
export function IOViewerToolbar({
  label,
  collapsed,
  format,
  onFormatChange,
  formatOptions,
  isChat,
  chatLayout,
  onChatLayoutChange,
  markdownSubmode,
  onMarkdownSubmodeChange,
  translation,
  traceId,
  spanId,
  spanType,
  mode,
  fieldAnchor,
  originalContent,
  copyText,
}: IOViewerToolbarProps) {
  const actions = useIOActions({
    translation,
    traceId,
    spanId,
    spanType,
    mode,
    fieldAnchor,
    originalContent,
  });

  return (
    <>
      <IOActionsRow
        actions={actions}
        collapsed={collapsed}
        formatWidthKey={`${format}:${isChat}`}
        formatSelect={
          collapsed ? null : (
            <FormatSelect
              value={format}
              onChange={onFormatChange}
              ariaLabel={`${label} view format`}
              options={formatSelectOptions({
                formatOptions,
                isChat,
                chatLayout,
                onChatLayoutChange,
                markdownSubmode,
                onMarkdownSubmodeChange,
              })}
            />
          )
        }
      />
      <CopyButton text={copyText} />
    </>
  );
}
