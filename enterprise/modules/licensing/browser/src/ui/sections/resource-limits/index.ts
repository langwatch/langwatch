/**
 * What a plan allows, drawn as rows a reader can compare against usage.
 * Billing and organization both draw from it (a full plan, one seat row)
 * off the same licence — one surface, not a component each side copies.
 */
export { ResourceLimitRow } from "./resource-limit-row.tsx";
export {
  mapLicenseStatusToLimits,
  mapUsageToLimits,
  RESOURCE_LABELS,
  ResourceLimitsDisplay,
} from "./resource-limits-display.tsx";
export { LIMIT_TYPE_DISPLAY_LABELS } from "../../../model/limit-type-labels.ts";
