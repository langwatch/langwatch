import { useCallback, useEffect, useState } from "react";

export const TABS = ["buckets", "objects", "requests"] as const;
export type TabId = (typeof TABS)[number];

const fromHash = () => TABS.find((tab) => tab === window.location.hash.slice(1)) ?? "buckets";

/** The open tab, kept in location.hash so a tab can be linked to. */
export const useHashTab = () => {
  const [tab, setTab] = useState<TabId>(fromHash);
  useEffect(() => {
    const onChange = () => setTab(fromHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const open = useCallback((next: TabId) => {
    window.location.hash = next;
    setTab(next);
  }, []);
  return { tab, open };
};
