/**
 * The block picker is URL-routed: it is open while the address carries
 * `addBlock=open`, so it survives a reload and the back button closes it.
 */

import { useAnalyticsHost } from "../../../model/analytics-host.ts";

export const BLOCK_PICKER_QUERY_KEY = "addBlock";
const OPEN = "open";

export function useBlockPickerAddress() {
  const host = useAnalyticsHost();
  const query = host.route().query;
  return {
    isOpen: query[BLOCK_PICKER_QUERY_KEY] === OPEN,
    open: () => host.setQuery({ ...query, [BLOCK_PICKER_QUERY_KEY]: OPEN }),
    close: () => host.setQuery({ ...query, [BLOCK_PICKER_QUERY_KEY]: void 0 }),
  };
}
