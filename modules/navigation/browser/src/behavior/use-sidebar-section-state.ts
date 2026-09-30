/** Sidebar group open state, remembered per device; storage key unchanged on purpose */

import { useEffect, useState, useSyncExternalStore } from "react";

import {
  getSidebarSectionOverride,
  subscribeSidebarSectionOverrides,
} from "./sidebar-section-store.ts";

export const getSidebarSectionStorageKey = (id: string) =>
  `langwatch:main-sidebar-section:${id}:expanded:v1`;

const readSaved = ({ id, defaultExpanded }: { id: string; defaultExpanded: boolean }) => {
  const saved = window.localStorage.getItem(getSidebarSectionStorageKey(id));
  return saved === "true" || saved === "false" ? saved === "true" : defaultExpanded;
};

export const useSidebarSectionState = ({
  id,
  defaultExpanded,
}: {
  id: string;
  defaultExpanded: boolean;
}) => {
  const [isExpanded, setIsExpanded] = useState(() => readSaved({ id, defaultExpanded }));
  const override = useSyncExternalStore(subscribeSidebarSectionOverrides, () =>
    getSidebarSectionOverride(id),
  );

  useEffect(() => {
    setIsExpanded(readSaved({ id, defaultExpanded }));
  }, [defaultExpanded, id]);

  const toggleSection = () => {
    const nextExpanded = !isExpanded;
    setIsExpanded(nextExpanded);
    window.localStorage.setItem(getSidebarSectionStorageKey(id), String(nextExpanded));
  };

  return { isExpanded: override ?? isExpanded, toggleSection };
};
