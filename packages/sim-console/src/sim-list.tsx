import { List, ListItem, Panel } from "@langwatch/design-system-internal";
import type { KeyboardEvent, ReactNode } from "react";

export type SimListProps<T> = {
  items: T[];
  rowKey: (item: T) => string;
  renderRow: (item: T) => ReactNode;
  /** A row's second line, under its title. */
  rowDescription?: (item: T) => ReactNode;
  /** Right-aligned beside the row, as a time or a count. */
  rowMeta?: (item: T) => ReactNode;
  /** Given, the list sits in a titled panel: `meta` beside the title, `actions` at its end. */
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
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
  rowDescription,
  rowMeta,
  title,
  meta,
  actions,
  selectedKey,
  onSelect,
  empty,
}: SimListProps<T>) => {
  const body =
    items.length === 0 ? (
      <>{empty}</>
    ) : (
      <div
        className="sim-list"
        role="presentation"
        onKeyDown={onSelect === undefined ? undefined : (event) => moveFocus({ event })}
      >
        <List>
          {items.map((item) => {
            const key = rowKey(item);
            const row = {
              title: renderRow(item),
              description: rowDescription?.(item),
              meta: rowMeta?.(item),
              current: key === selectedKey,
            };
            return onSelect === undefined ? (
              <ListItem key={key} {...row} />
            ) : (
              <ListItem key={key} {...row} onSelect={() => onSelect(key)} />
            );
          })}
        </List>
      </div>
    );
  if (title === undefined) return body;
  return (
    <Panel title={title} meta={meta} actions={actions}>
      {body}
    </Panel>
  );
};
