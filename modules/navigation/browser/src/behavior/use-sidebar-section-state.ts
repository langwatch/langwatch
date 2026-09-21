/** Sidebar group open state, remembered per device; storage key unchanged on purpose */

import { useEffect, useState, useSyncExternalStore } from "react";

import {
  getSidebarSectionOverride,
  subscribeSidebarSectionOverrides,
} from "./sidebar-section-store.ts";

export const getSidebarSectionStorageKey = (id: string) =>
  `langwatch:main-sidebar-section:${id}:expanded:v1`;

export const useSidebarSectionState = ({
  id,
  defaultExpanded,
}: {
  id: string;
  defaultExpanded: boolean;
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const override = useSyncExternalStore(subscribeSidebarSectionOverrides, () =>
    getSidebarSectionOverride(id),
  );

  useEffect(() => {
    const savedPreference = window.localStorage.getItem(getSidebarSectionStorageKey(id));
    setIsExpanded(
      savedPreference === "true" || savedPreference === "false"
        ? savedPreference === "true"
        : defaultExpanded,
    );
  }, [defaultExpanded, id]);

  const toggleSection = () => {
    const nextExpanded = !isExpanded;
    setIsExpanded(nextExpanded);
    window.localStorage.setItem(getSidebarSectionStorageKey(id), String(nextExpanded));
  };

  return { isExpanded: override ?? isExpanded, toggleSection };
};
