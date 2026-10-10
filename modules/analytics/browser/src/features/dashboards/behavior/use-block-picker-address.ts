/**
 * "Add a widget" is URL-routed: it is open while the address carries `addBlock=open`, so it
 * survives a reload and the back button closes it. The key keeps its name so saved links work.
 */

import { useAnalyticsHost } from "../../../model/analytics-host.ts";

export const WIDGET_PICKER_QUERY_KEY = "addBlock";
const OPEN = "open";

export function useBlockPickerAddress() {
  const host = useAnalyticsHost();
  const query = host.route().query;
  return {
    isOpen: query[WIDGET_PICKER_QUERY_KEY] === OPEN,
    open: () => host.setQuery({ ...query, [WIDGET_PICKER_QUERY_KEY]: OPEN }),
    close: () => host.setQuery({ ...query, [WIDGET_PICKER_QUERY_KEY]: void 0 }),
  };
}
