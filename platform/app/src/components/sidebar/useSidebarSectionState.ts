import { useEffect, useState } from "react";

import { trackEvent } from "~/utils/tracking";
import { useSidebarSectionOverrides } from "./sidebarSectionOverrides";

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
  // The guided tour folds and opens a group without touching the user's
  // preference; while an override is set it is what the section shows.
  const override = useSidebarSectionOverrides((s) => s.overrides[id]);

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

  return { isExpanded: override ?? isExpanded, toggleSection };
};
