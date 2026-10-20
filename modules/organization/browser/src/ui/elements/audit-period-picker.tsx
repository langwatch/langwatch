/**
 * The window picker above the audit table, the presentation half of
 * `model/audit-period.ts`: presets only, matching what its URL carries.
 */

import { DateRangePicker } from "@langwatch/design-system/date-range-picker";

import { AUDIT_PERIOD_PRESETS, type AuditPeriodPresetKey } from "../../model/audit-period.ts";

export function AuditPeriodPicker({
  label,
  onPick,
}: {
  label: string;
  onPick: (presetKey: AuditPeriodPresetKey) => void;
}) {
  return (
    <DateRangePicker
      presets={AUDIT_PERIOD_PRESETS}
      triggerLabel={label}
      onPresetSelect={onPick}
      size="sm"
    />
  );
}
