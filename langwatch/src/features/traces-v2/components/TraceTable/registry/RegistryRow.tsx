import type { Row } from "@tanstack/react-table";
import React from "react";
import { useDensityTokens } from "../../../hooks/useDensityTokens";
import { useDensityStore } from "../../../stores/densityStore";
import type { TraceStatus } from "../../../types/trace";
import { Tbody, Td, Tr } from "../TablePrimitives";
import { ROW_STYLES, StatusRowGroup, rowVariantFor } from "../StatusRow";
import { cellPropsFor } from "../TraceTableShell";
import { pickCell, type Registry, type RowActions } from "./types";

interface RegistryRowProps<TRow> {
  tanstackRow: Row<TRow>;
  registry: Registry<TRow>;
  addons: string[];
  status: TraceStatus;
  /**
   * `unified` groups the main row and addon rows under one hover/animation
   * scope (trace lens). `split` lets the main row hover independently while
   * addons own their own interactions (conversation/group lens).
   */
  hoverScope: "unified" | "split";
  isSelected?: boolean;
  isFocused?: boolean;
  isExpanded?: boolean;
  isNew?: boolean;
  rowDomId?: string;
  onSelect?: () => void;
  onTogglePeek?: () => void;
  onToggleExpand?: () => void;
  /** Forwarded to the outer <tbody> so the virtualizer can measure each row. */
  ref?: React.Ref<HTMLTableSectionElement>;
  "data-index"?: number;
}

export function RegistryRow<TRow>({
  tanstackRow,
  registry,
  addons,
  status,
  hoverScope,
  isSelected = false,
  isFocused = false,
  isExpanded = false,
  isNew = false,
  rowDomId,
  onSelect,
  onTogglePeek,
  onToggleExpand,
  ref,
  "data-index": dataIndex,
}: RegistryRowProps<TRow>): React.ReactElement {
  const tokens = useDensityTokens();
  const densityMode = useDensityStore((s) => s.density);

  const variant = rowVariantFor({ isSelected, status });
  const style = ROW_STYLES[variant];
  const visibleCells = tanstackRow.getVisibleCells();
  const colCount = visibleCells.length;

  const actions: RowActions = {
    onSelect,
    onTogglePeek,
    onToggleExpand,
  };

  const renderedAddons = addons
    .map((id) => registry.addons[id])
    .filter(
      (def): def is NonNullable<typeof def> =>
        Boolean(def) &&
        def!.shouldRender({
          row: tanstackRow.original,
          isExpanded,
          densityMode,
        }),
    );
  const hasAddons = renderedAddons.length > 0;

  const handleRowClick = () => {
    if (onSelect) {
      onSelect();
    } else if (onToggleExpand) {
      onToggleExpand();
    }
  };

  const mainRow = (
    <Tr
      borderBottomWidth={hasAddons ? "0" : "1px"}
      borderBottomColor="border.muted"
      outline={isFocused ? "1px solid" : undefined}
      outlineColor={isFocused ? "blue.fg" : undefined}
      cursor={onSelect || onToggleExpand ? "pointer" : "default"}
      onClick={hoverScope === "split" ? handleRowClick : undefined}
      bg={hoverScope === "split" ? style.bg : undefined}
      _hover={
        hoverScope === "split" ? { bg: style.hoverBg } : undefined
      }
    >
      {visibleCells.map((cell, i) => (
        <Td
          key={cell.id}
          bg={hoverScope === "unified" ? style.bg : undefined}
          padding={`${tokens.rowPaddingY} 8px`}
          {...cellPropsFor(cell, style.borderColor, i)}
        >
          {pickCell(registry, cell.column.id, densityMode, {
            row: tanstackRow.original,
            density: tokens,
            densityMode,
            isExpanded,
            isSelected,
            isFocused,
            actions,
          })}
        </Td>
      ))}
    </Tr>
  );

  const addonRows = renderedAddons.map((addon) => (
    <React.Fragment key={addon.id}>
      {addon.render({
        row: tanstackRow.original,
        density: tokens,
        densityMode,
        colSpan: colCount,
        style,
        isExpanded,
        isSelected,
        tanstackRow,
        actions,
      })}
    </React.Fragment>
  ));

  if (hoverScope === "unified") {
    return (
      <StatusRowGroup
        ref={ref}
        data-index={dataIndex}
        style={style}
        onClick={onSelect}
        traceId={rowDomId}
        isNew={isNew}
      >
        {mainRow}
        {addonRows}
      </StatusRowGroup>
    );
  }

  return (
    <Tbody
      ref={ref}
      data-index={dataIndex}
      css={{ "& > tr, & > tr > td": { transition: "none" } }}
    >
      {mainRow}
      {addonRows}
    </Tbody>
  );
}
