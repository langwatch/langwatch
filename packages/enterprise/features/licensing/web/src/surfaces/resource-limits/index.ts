/**
 * What a plan allows, drawn as rows a reader can compare against usage.
 *
 * Billing draws it under a plan, and organization draws one row of it next to
 * the seat count. Both read the same limits off the same licence, so the
 * drawing and the two mappings that feed it are one surface rather than a
 * component each side copies.
 */
export { ResourceLimitRow } from "./resource-limit-row";
export {
  mapLicenseStatusToLimits,
  mapUsageToLimits,
  RESOURCE_LABELS,
  ResourceLimitsDisplay,
} from "./resource-limits-display";
export { LIMIT_TYPE_DISPLAY_LABELS } from "../../model/limit-type-labels";
