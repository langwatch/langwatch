import { readSlice } from "@langwatch/browser-host/global-store";
import {
  LANGY_ABSENT_SURFACE,
  LANGY_STORE_SLICE,
  type LangySliceSurface,
} from "@langwatch/langy-contract";

export type { LangyContextChip } from "@langwatch/langy-contract";

/** Langy's panel state, read from the global UI store (`langy:store`); Langy owns the writes. */
export const useLangyStore = readSlice<LangySliceSurface>({
  name: LANGY_STORE_SLICE,
  absent: LANGY_ABSENT_SURFACE,
});
