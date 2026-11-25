/** The library's create dialog, opened by its button or its address. ADR-002. */

import { NEW_DASHBOARD_QUERY_KEY } from "@langwatch/analytics-client";
import { useEffect, useState } from "react";

import { useAnalyticsHost } from "../../../model/analytics-host.ts";

/**
 * `?new=1`, as Quick Search's "Create a dashboard" sends it, opens the dialog once the member may
 * create; the key is dropped in place, so going back or refreshing never opens it again.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */
export function useLibraryCreateDialog({ mayCreate }: { mayCreate: boolean }): {
  isOpen: boolean;
  open: () => void;
  close: () => void;
} {
  const host = useAnalyticsHost();
  const [isOpen, setIsOpen] = useState(false);
  const isAsked = host.route().query[NEW_DASHBOARD_QUERY_KEY] !== void 0;

  useEffect(() => {
    if (!isAsked || !mayCreate) return;
    setIsOpen(true);
    const rest = Object.fromEntries(
      Object.entries(host.route().query).filter(([key]) => key !== NEW_DASHBOARD_QUERY_KEY),
    );
    host.setQuery(rest, { replace: true });
  }, [host, isAsked, mayCreate]);

  return { isOpen, open: () => setIsOpen(true), close: () => setIsOpen(false) };
}
