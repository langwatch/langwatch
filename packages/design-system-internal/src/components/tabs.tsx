import { moveRovingFocus } from "./roving-focus.ts";

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
