import { useEffect, useState } from "react";

import { trackEvent } from "~/utils/tracking";

export const getSidebarSectionStorageKey = (id: string) =>
  `langwatch:main-sidebar-section:${id}:expanded:v1`;

export const useSidebarSectionState = ({
  id,
  label,
  defaultExpanded,
  projectId,
}: {
  id: string;
  label: string;
  defaultExpanded: boolean;
  projectId?: string;
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  useEffect(() => {
    const savedPreference = window.localStorage.getItem(
      getSidebarSectionStorageKey(id),
    );
    setIsExpanded(
      savedPreference === "true" || savedPreference === "false"
        ? savedPreference === "true"
        : defaultExpanded,
    );
  }, [defaultExpanded, id]);

  const toggleSection = () => {
    const nextExpanded = !isExpanded;
    setIsExpanded(nextExpanded);
    window.localStorage.setItem(
      getSidebarSectionStorageKey(id),
      String(nextExpanded),
    );
    trackEvent("side_menu_section_toggle", {
      project_id: projectId,
      menu_item: label,
      expanded: nextExpanded,
    });
  };

  return { isExpanded, toggleSection };
};
