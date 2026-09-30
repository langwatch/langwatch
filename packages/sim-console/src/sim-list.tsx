import { List, ListItem } from "@langwatch/design-system-internal";
import type { KeyboardEvent, ReactNode } from "react";

export type SimListProps<T> = {
  items: T[];
  rowKey: (item: T) => string;
  renderRow: (item: T) => ReactNode;
  selectedKey?: string;
  /** Without it the rows are read-only. */
  onSelect?: (key: string) => void;
  empty?: ReactNode;
};

const STEPS: Record<string, (input: { at: number; last: number }) => number> = {
  ArrowDown: ({ at, last }) => Math.min(at + 1, last),
  ArrowUp: ({ at }) => Math.max(at - 1, 0),
  Home: () => 0,
  End: ({ last }) => last,
};

/** Arrow keys, Home and End move focus between the rows; Enter or Space opens one. */
const moveFocus = ({ event }: { event: KeyboardEvent<HTMLDivElement> }) => {
  const step = STEPS[event.key];
  if (step === undefined) return;
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button.ds-list-row"));
  const at = rows.findIndex((row) => row === document.activeElement);
  if (rows.length === 0) return;
  event.preventDefault();
  rows[at === -1 ? 0 : step({ at, last: rows.length - 1 })]?.focus();
};

export const SimList = <T,>({
  items,
  rowKey,
  renderRow,
  selectedKey,
  onSelect,
  empty,
}: SimListProps<T>) => {
  if (items.length === 0) return <>{empty}</>;
  return (
    <div
      className="sim-list"
      role="presentation"
      onKeyDown={onSelect === undefined ? undefined : (event) => moveFocus({ event })}
    >
      <List>
        {items.map((item) => {
          const key = rowKey(item);
          return onSelect === undefined ? (
            <ListItem key={key} title={renderRow(item)} current={key === selectedKey} />
          ) : (
            <ListItem
              key={key}
              title={renderRow(item)}
              current={key === selectedKey}
              onSelect={() => onSelect(key)}
            />
          );
        })}
      </List>
    </div>
  );
};
