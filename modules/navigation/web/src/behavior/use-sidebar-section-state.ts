/**
 * Whether a sidebar group is open, remembered per device.
 *
 * Moved from `platform/app/src/components/sidebar/useSidebarSectionState.ts`.
 * The storage key is unchanged on purpose: a reader who had a group closed
 * keeps it closed across the move. `trackEvent("side_menu_section_toggle")`
 * did not travel — `platform/app/src/utils/tracking` no longer exists, and
 * product analytics belongs to the application rather than to a package.
 *
 * `localStorage` directly rather than through the host, the way this package's
 * own `product-memory` already reads it: nothing else in the product reads
 * this key, so there is no second reader for a split brain to open between.
 */

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
