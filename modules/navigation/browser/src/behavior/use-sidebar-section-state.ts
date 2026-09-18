/** Sidebar group open state, remembered per device; storage key unchanged on purpose */

import { useEffect, useState } from "react";

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

  return { isExpanded, toggleSection };
};
