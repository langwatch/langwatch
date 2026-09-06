/**
 * What Langy puts in the slots core screens leave open: the remembered answer to how Langy
 * reaches this person's code, on the Integrations screen's GitHub card (ADR-129).
 */

import { LangyCodeAccessPreference } from "@langwatch/langy-web/surfaces/langy-code-access-preference";
import type { UiSlotComponents } from "@langwatch/ui-host/slots";

export const langyUiSlots: UiSlotComponents = {
  langyCodeAccessPreference: LangyCodeAccessPreference,
};
