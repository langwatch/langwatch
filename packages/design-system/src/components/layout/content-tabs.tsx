import type { ReactNode } from "react";

import { Kbd } from "../display/kbd.tsx";
import { TabCount } from "../values/tab-count.tsx";
import { TabsMachine } from "./tabs-parts/machine.tsx";

export interface ContentTabItem<Value extends string = string> {
  /** Unique within `items`. */
  value: Value;
  /** The accessible name; sentence case ("Teams & projects"). */
  label: string;
  /** 14px lucide, leading. */
  icon?: ReactNode;
  /** A zero shows; undefined (still reading) draws nothing. */
  count?: number;
  /** A disabled tab says why; a tab that does not apply is left out of `items`. */
  disabled?: { reason: string };
  /** "g p": drawn as Kbd and set as aria-keyshortcuts; the caller binds the key. */
  shortcut?: string;
  /** One muted line at the top of this tab's open panel; the panel's aria-describedby. */
  description?: string;
  /** The panel. */
  content: ReactNode;
  /** On the trigger: "prompt-tab-conversation". */
  testId?: string;
}

export interface ContentTabsProps<Value extends string = string> {
  /** Controlled only; a ?tab= query param or useState lives in the owner, which normalises it. */
  value: Value;
  onValueChange: (args: { value: Value }) => void;
  items: readonly ContentTabItem<Value>[];
  /** Names the tablist: "Credentials", "Snippet language". */
  label: string;
  /** `compact` for tabs inside a drawer pane, a card or a code block. Default "default". */
  density?: "default" | "compact";
  /** `flush`: the content draws its own panes (editors, code, grids). Default "padded". */
  body?: "padded" | "flush";
  /**
   * `sm` pads the list and the panel sides by 16px, `md` by 24px; the rule stays full width.
   * Default "none".
   */
  inset?: "none" | "sm" | "md";
  /**
   * `page`: no height of its own. `panel`: fills its parent, the open panel scrolls. `content`:
   * as `panel`, but the content owns the scrolling. Default "page".
   */
  scroll?: "page" | "panel" | "content";
  /** `lazy`: on first open, then kept. `active`: only while open. `all`: always. Default "lazy". */
  mount?: "lazy" | "active" | "all";
  /** `manual`: arrows move focus only, Enter or Space selects. Default "automatic". */
  activationMode?: "automatic" | "manual";
  /** A stable slot between the strip and the panels (a resize divider). */
  panelHeader?: ReactNode;
  /** Right end of the strip, outside the tablist: an xs button or a switch, never tabs. */
  actions?: ReactNode;
  /** Base for trigger and panel ids; default useId(). */
  id?: string;
  testId?: string;
}

/**
 * Tabs for views of one subject inside a page, drawer, dialog or card: tablist, tab and
 * tabpanel, one underline look. Routed header tabs are `PageLayout.Tabs`; a filter with no
 * panels is `FilterChips` or `SegmentedControl`.
 */
export function ContentTabs<Value extends string>({ items, ...props }: ContentTabsProps<Value>) {
  return (
    <TabsMachine
      {...props}
      items={items.map((item) => ({
        value: item.value,
        disabled: item.disabled,
        shortcut: item.shortcut,
        description: item.description,
        testId: item.testId,
        panel: item.content,
        trigger: (
          <>
            {item.icon}
            {item.label}
            <TabCount value={item.count} />
            {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
          </>
        ),
      }))}
    />
  );
}
