import { createListCollection } from "@chakra-ui/react";
import {
  INDEFINITE_RETENTION_DAYS,
  type RetentionCategory,
  type RetentionScopeType,
} from "@langwatch/data-retention-contract";
import { Building2, Folder, Users } from "lucide-react";

export const CATEGORY_LABELS: Record<RetentionCategory, string> = {
  traces: "Traces & Spans",
  scenarios: "Scenarios",
  experiments: "Experiments",
};

export const SCOPE_ICON: Record<RetentionScopeType, typeof Building2> = {
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

export type RetentionPreset = { value: string; label: string; days: number };

// Presets round up to cover the full period plus buffer. Plan-gated by tier:
// PAID → {35, 63}; ENTERPRISE → full list + custom. Server re-enforces at
// the mutation boundary; these lists only shape the UI.

/** Paid (non-enterprise) menu: "~1 month" / "~2 months" only. */
export const PAID_RETENTION_PRESETS: RetentionPreset[] = [
  { value: "35", label: "1 month", days: 35 },
  { value: "63", label: "2 months", days: 63 },
];

/** Enterprise / self-hosted menu: the paid short options plus longer windows. */
export const ENTERPRISE_RETENTION_PRESETS: RetentionPreset[] = [
  { value: "35", label: "1 month", days: 35 },
  { value: "63", label: "2 months", days: 63 },
  { value: "91", label: "3 months", days: 91 },
  { value: "371", label: "1 year", days: 371 },
  { value: "1827", label: "5 years", days: 1827 },
];

/** The preset list a plan tier may pick from. Enterprise (and self-hosted,
 *  which resolves to enterprise) additionally gets a custom field. */
export function retentionPresetsForTier(isEnterprise: boolean): RetentionPreset[] {
  return isEnterprise ? ENTERPRISE_RETENTION_PRESETS : PAID_RETENTION_PRESETS;
}

/** Select value for a grandfathered policy whose stored retention isn't offered
 *  on the org's current plan. Rendered read-only so editing never silently
 *  coerces (or shortens → deletes) an out-of-menu value. */
export const LEGACY_PRESET_VALUE = "legacy";

/** Human label for the read-only legacy option. */
export function legacyLabel(days: number): string {
  return days === INDEFINITE_RETENTION_DAYS
    ? "Current: keep forever (legacy)"
    : `Current: ${days} days (legacy)`;
}

export type RetentionMenuItem = { value: string; label: string };

/**
 * Builds the plan-gated retention menu (legacy, presets, keep-forever for
 * admins, custom for enterprise). Pure function for unit-testability.
 */
export function buildRetentionMenuItems({
  isEnterprise,
  isPlatformAdmin,
  legacyDays,
}: {
  isEnterprise: boolean;
  isPlatformAdmin: boolean;
  legacyDays: number | null;
}): RetentionMenuItem[] {
  return [
    ...(legacyDays !== null
      ? [{ value: LEGACY_PRESET_VALUE, label: legacyLabel(legacyDays) }]
      : []),
    ...retentionPresetsForTier(isEnterprise).map((p) => ({
      value: p.value,
      label: p.label,
    })),
    ...(isPlatformAdmin
      ? [
          {
            value: INDEFINITE_PRESET_VALUE,
            label: "No retention (keep forever)",
          },
        ]
      : []),
    ...(isEnterprise ? [{ value: CUSTOM_PRESET_VALUE, label: "Custom…" }] : []),
  ];
}

export const CUSTOM_PRESET_VALUE = "custom";

/** The "keep forever" option's select value — the stringified indefinite
 *  sentinel. Only offered to platform admins (see AddOverrideDrawer); the
 *  mutation route authorizes it independently. */
export const INDEFINITE_PRESET_VALUE = String(INDEFINITE_RETENTION_DAYS);

export const BINDING_SCOPE_TIERS: Record<RetentionScopeType, number> = {
  ORGANIZATION: 0,
  TEAM: 1,
  PROJECT: 2,
};
