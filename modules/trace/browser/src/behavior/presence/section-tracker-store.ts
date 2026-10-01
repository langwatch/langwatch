import { readSlice } from "@langwatch/browser-host/global-store";
import {
  PRESENCE_SECTION_TRACKER_SLICE,
  SECTION_TRACKER_ABSENT,
  type SectionTrackerState,
} from "@langwatch/presence-contract";

export { pickMostVisibleSection } from "@langwatch/presence-contract";

/** Which section the reader is looking at, read from `presence:section-tracker`. */
export const useSectionTrackerStore = readSlice<SectionTrackerState>({
  name: PRESENCE_SECTION_TRACKER_SLICE,
  absent: SECTION_TRACKER_ABSENT,
});
