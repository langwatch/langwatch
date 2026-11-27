/** Whether Langy's floating card was open when a drawer opened, read once at mount. */

import { readSlice } from "@langwatch/browser-host/global-store";
import {
  LANGY_ABSENT_SURFACE,
  LANGY_STORE_SLICE,
  type LangySliceSurface,
} from "@langwatch/langy-contract";
import { useState } from "react";

/** Langy's panel state in the global UI store (`langy:store`); Langy owns the writes. */
const useLangyStore = readSlice<LangySliceSurface>({
  name: LANGY_STORE_SLICE,
  absent: LANGY_ABSENT_SURFACE,
});

/** The floating card hops left out of a drawer's way; a drawer opening then waits for it. */
export function useFloatingLangyAtOpen(): boolean {
  const floatingOpen = useLangyStore((s) => s.isOpen && s.panelMode === "floating");
  const [atOpen] = useState(floatingOpen);
  return atOpen;
}
