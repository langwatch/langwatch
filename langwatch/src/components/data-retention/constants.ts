import { createListCollection } from "@chakra-ui/react";
import { Building2, Folder, Users } from "lucide-react";
import type { ScopeTriadType } from "~/components/settings/ScopeChipPicker";
import {
  INDEFINITE_RETENTION_DAYS,
  type RetentionCategory,
} from "~/server/data-retention/retentionPolicy.schema";

export const CATEGORY_LABELS: Record<RetentionCategory, string> = {
  traces: "Traces & Spans",
  scenarios: "Scenarios",
  experiments: "Experiments",
};

export const SCOPE_ICON: Record<ScopeTriadType, typeof Building2> = {
  ORGANIZATION: Building2,
  TEAM: Users,
  PROJECT: Folder,
};

// Retention is always stored in days, but the picker speaks human time. All
// units round-trip through whole weeks so the resulting day count is always
// a valid 7-multiple — 1 month = 4 weeks (28 days), 1 year = 52 weeks (364
// days). This is the same calendar arithmetic ClickHouse partition pruning
// expects.
export const DAYS_PER_UNIT = { weeks: 7, months: 28, years: 364 } as const;
export type RetentionUnit = keyof typeof DAYS_PER_UNIT;

export const RETENTION_UNIT_LABELS: Record<RetentionUnit, string> = {
  weeks: "weeks",
  months: "months",
  years: "years",
};

export const retentionUnitCollection = createListCollection({
  items: (Object.keys(DAYS_PER_UNIT) as RetentionUnit[]).map((u) => ({
    value: u,
    label: RETENTION_UNIT_LABELS[u],
  })),
});

// Presets round UP relative to the human label so the selection covers the
// full period plus a small buffer (e.g. "1 year" = 371d, not 364d). Avoids
// underselling: a user who picks "1 year" expects at least a full year.
export const RETENTION_PRESETS: Array<{
  value: string;
  label: string;
  days: number;
}> = [
  { value: "49", label: "7 weeks", days: 49 },
  { value: "91", label: "3 months", days: 91 },
  { value: "182", label: "6 months", days: 182 },
  { value: "371", label: "1 year", days: 371 },
  { value: "735", label: "2 years", days: 735 },
  { value: "1827", label: "5 years", days: 1827 },
];

export const CUSTOM_PRESET_VALUE = "custom";

/** The "keep forever" option's select value — the stringified indefinite
 *  sentinel. Only offered to platform admins (see AddOverrideDrawer); the
 *  mutation route authorizes it independently. */
export const INDEFINITE_PRESET_VALUE = String(INDEFINITE_RETENTION_DAYS);

export const SCOPE_TIER_ORDER: Record<ScopeTriadType, number> = {
  ORGANIZATION: 0,
  TEAM: 1,
  PROJECT: 2,
};
