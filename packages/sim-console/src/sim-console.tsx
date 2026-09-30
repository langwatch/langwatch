import "./sim-console.css";
import { consoleLinks, StatusDot, Tabs, TopBar } from "@langwatch/design-system-internal";
import { useEffect, useMemo, useRef, type ReactNode } from "react";

export type SimKind = "mail" | "idp" | "storage" | "llm" | "voice";

export type SimTab = { id: string; label: string; count?: number };

export type SimStatus = { tone: "ok" | "warn" | "error"; text: string };

export type SimConsoleProps = {
  /** Drives the accent colour of the console's mark. */
  sim: SimKind;
  title: string;
  /** Read off the page's host when empty or absent. */
  stackSlug?: string;
  /** No tab bar is drawn for an empty list. */
  tabs: SimTab[];
  activeTab: string;
  onTab: (id: string) => void;
  status: SimStatus;
  actions?: ReactNode;
  children: ReactNode;
};

const DOT = { ok: "live", warn: "starting", error: "down" } as const;

const hashTab = () => window.location.hash.replace(/^#/u, "");

/** The tab is kept in `location.hash`: read on load and on every hash change, written on a pick. */
const useHashTab = ({
  tabs,
  activeTab,
  onTab,
}: Pick<SimConsoleProps, "tabs" | "activeTab" | "onTab">) => {
  const latest = useRef({ tabs, activeTab, onTab });
  latest.current = { tabs, activeTab, onTab };

  // Re-read when the tab ids change, so a tab that appears once its data loads can be linked to.
  const ids = tabs.map((tab) => tab.id).join(" ");
  useEffect(() => {
    const follow = () => {
      const id = hashTab();
      const { tabs: known, activeTab: current, onTab: open } = latest.current;
      if (id !== current && known.some((tab) => tab.id === id)) open(id);
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [ids]);

  return (id: string) => {
    window.history.replaceState(null, "", `#${id}`);
    onTab(id);
  };
};

/** A simulator's console: fixed header, a tab bar, then a scrolling main area. */
export const SimConsole = ({
  sim,
  title,
  stackSlug,
  tabs,
  activeTab,
  onTab,
  status,
  actions,
  children,
}: SimConsoleProps) => {
  const chrome = useMemo(() => consoleLinks({ location: window.location }), []);
  const pick = useHashTab({ tabs, activeTab, onTab });
  return (
    <div className="sim-console" data-sim={sim}>
      <TopBar
        name={title}
        slug={stackSlug || chrome.slug}
        homeHref={chrome.homeHref}
        links={chrome.links}
        actions={
          <>
            <output>
              <StatusDot state={DOT[status.tone]} label={status.text} />
            </output>
            {actions}
          </>
        }
      />
      {tabs.length > 0 && (
        <div className="sim-console-tabs">
          <Tabs label={`${title} sections`} tabs={tabs} value={activeTab} onChange={pick} />
        </div>
      )}
      <main className="sim-console-main">
        <div className="ds-page-frame">{children}</div>
      </main>
    </div>
  );
};
