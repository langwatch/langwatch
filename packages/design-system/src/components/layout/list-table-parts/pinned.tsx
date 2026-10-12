import { IconButton, Table, VisuallyHidden } from "@chakra-ui/react";
import { ChevronRight } from "lucide-react";
import { type ReactNode, use } from "react";

import { Checkbox } from "../../forms/checkbox.tsx";
import { IdText, type IdTextProps } from "../../values/id-text.tsx";
import { Cell, type ListTableCellProps } from "./parts.tsx";
import { type DataAttributes, RowContext, STOP_ROW, dataAttributes } from "./shared.ts";

/** Sticky columns paint the row's ground (see the root), so scrolled cells never show through. */
const PIN_START = { "data-pin": "start" } as const;
const PIN_END = { "data-pin": "end" } as const;
const SELECT_ALL = { "data-select-all": "" };

export interface ListTableActionHeaderProps {
  /** Default "Actions". */
  label?: string;
}

/** The pinned header over the action column; empty, with a hidden name for screen readers. */
export function ActionHeader({ label = "Actions" }: ListTableActionHeaderProps) {
  return (
    <Table.ColumnHeader {...PIN_END}>
      <VisuallyHidden>{label}</VisuallyHidden>
    </Table.ColumnHeader>
  );
}

export interface ListTableActionCellProps extends DataAttributes {
  children: ReactNode;
}

/** The row's actions (an overflow menu, one icon button), pinned right; they never open the row. */
export function ActionCell({ children, ...rest }: ListTableActionCellProps) {
  return (
    <Table.Cell
      {...PIN_END}
      {...STOP_ROW}
      onClick={(event) => event.stopPropagation()}
      {...dataAttributes(rest)}
    >
      {children}
    </Table.Cell>
  );
}

export interface ListTableIdCellProps extends Omit<ListTableCellProps, "children">, IdTextProps {}

/** A cell holding an identifier: IdText, cut in the middle, with a copy button. */
export function IdCell({ value, label, tail, copyable, ...cell }: ListTableIdCellProps) {
  return (
    <Cell data-id-cell="" {...cell}>
      <IdText value={value} label={label} tail={tail} copyable={copyable} />
    </Cell>
  );
}

export interface ListTableSelectHeaderProps {
  /** The caller derives the tri-state from ITS selection, not from the rendered rows. */
  checked: boolean | "indeterminate";
  onCheckedChange: (args: { checked: boolean }) => void;
  /** "Select all 25 rows". */
  label: string;
  disabled?: boolean;
}

/** The select-all checkbox over the leading column, pinned left. */
export function SelectHeader({
  checked,
  onCheckedChange,
  label,
  disabled,
}: ListTableSelectHeaderProps) {
  return (
    <Table.ColumnHeader {...PIN_START} width="48px">
      <Checkbox
        size="sm"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(details) => onCheckedChange({ checked: details.checked === true })}
        inputProps={{ "aria-label": label, ...SELECT_ALL }}
      />
    </Table.ColumnHeader>
  );
}

export interface ListTableSelectCellProps {
  checked: boolean;
  onCheckedChange: (args: { checked: boolean }) => void;
  /** "Select Weather agent". */
  label: string;
  disabled?: boolean;
}

/** A row's checkbox, pinned left; ticking never opens the row. */
export function SelectCell({
  checked,
  onCheckedChange,
  label,
  disabled,
}: ListTableSelectCellProps) {
  const row = use(RowContext);
  return (
    <Table.Cell
      {...PIN_START}
      {...STOP_ROW}
      width="48px"
      onClick={(event) => event.stopPropagation()}
    >
      <Checkbox
        size="sm"
        checked={checked}
        disabled={disabled || row.disabled}
        onCheckedChange={(details) => onCheckedChange({ checked: details.checked === true })}
        inputProps={{ "aria-label": label }}
      />
    </Table.Cell>
  );
}

export interface ListTableExpandCellProps {
  expanded: boolean;
  onToggle: () => void;
  /** "Show details for event 4f2a". */
  label: string;
  /** The detail SpanRow id(s) it controls (a group controls many rows). */
  panelId: string | readonly string[];
}

const controls = (panelId: string | readonly string[]) =>
  typeof panelId === "string" ? panelId : panelId.join(" ");

/** A chevron button in a 40px column; `aria-expanded` lives on the button, not the row. */
export function ExpandCell({ expanded, onToggle, label, panelId }: ListTableExpandCellProps) {
  const row = use(RowContext);
  return (
    <Table.Cell {...PIN_START} {...STOP_ROW} width="40px" paddingX="2">
      <IconButton
        type="button"
        size="2xs"
        variant="ghost"
        aria-label={label}
        aria-expanded={expanded}
        aria-controls={expanded ? controls(panelId) : undefined}
        disabled={row.disabled}
        onClick={onToggle}
      >
        <ChevronRight
          aria-hidden
          style={{
            transform: expanded ? "rotate(90deg)" : undefined,
            transition: "transform 0.15s",
          }}
        />
      </IconButton>
    </Table.Cell>
  );
}
