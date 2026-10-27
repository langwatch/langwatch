import type { KeyboardEvent } from "react";

const steps: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/**
 * Arrow-key movement across a group of `[data-roving]` buttons (the tabs):
 * focuses the next one and answers its index, or undefined for any other key.
 */
const moveRovingFocus = ({ event }: { event: KeyboardEvent<HTMLElement> }): number | undefined => {
  const step = steps[event.key];
  const group = event.currentTarget.closest("[data-roving-group]");
  if (step === undefined || !group) return undefined;
  const items = Array.from(group.querySelectorAll<HTMLButtonElement>("[data-roving]"));
  const current = items.findIndex((item) => item === event.currentTarget);
  const next = (current + step + items.length) % items.length;
  event.preventDefault();
  items[next]?.focus();
  return next;
};

export type TabItem = { id: string; label: string; count?: number };

export type TabsProps = {
  /** Names the tab list for screen readers. */
  label: string;
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
};

/** The tab strip only; the console renders the selected view beneath it. */
export const Tabs = ({ label, tabs, value, onChange }: TabsProps) => (
  <div className="ds-tabs" role="tablist" aria-label={label} data-roving-group="">
    {tabs.map((tab) => {
      const selected = tab.id === value;
      return (
        <button
          key={tab.id}
          type="button"
          role="tab"
          className="ds-tab"
          data-roving=""
          aria-selected={selected}
          tabIndex={selected ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => {
            const next = moveRovingFocus({ event });
            const nextTab = next === undefined ? undefined : tabs[next];
            if (nextTab) onChange(nextTab.id);
          }}
        >
          {tab.label}
          {tab.count !== undefined && <span className="ds-tab-count">{tab.count}</span>}
        </button>
      );
    })}
  </div>
);
