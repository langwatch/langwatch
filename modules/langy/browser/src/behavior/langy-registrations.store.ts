import { defineSlice } from "@langwatch/browser-host/global-store";
import {
  LANGY_ABSENT_REGISTRATIONS,
  LANGY_REGISTRATIONS_SLICE,
  type LangyRegistrationsState,
} from "@langwatch/langy-contract";

/** How pages register handlers with Langy (`langy:registrations`); the provider fills it in. */
export const useLangyRegistrationsStore = defineSlice<LangyRegistrationsState>({
  name: LANGY_REGISTRATIONS_SLICE,
  create: () => LANGY_ABSENT_REGISTRATIONS,
});
