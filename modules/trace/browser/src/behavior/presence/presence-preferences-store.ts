import { readSlice } from "@langwatch/browser-host/global-store";
import {
  PRESENCE_PREFERENCES_ABSENT,
  PRESENCE_PREFERENCES_SLICE,
  type PresencePreferencesState,
} from "@langwatch/presence-contract";

/** The reader's presence choices (ghost mode), read from `presence:preferences`. */
export const usePresencePreferencesStore = readSlice<PresencePreferencesState>({
  name: PRESENCE_PREFERENCES_SLICE,
  absent: PRESENCE_PREFERENCES_ABSENT,
});
