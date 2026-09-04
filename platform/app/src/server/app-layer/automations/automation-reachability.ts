import { diagnoseFilterQueryReachability } from "~/server/app-layer/traces/filter-to-clickhouse";
import {
  diagnoseTriggerFilterReachability,
  type TriggerFilterReachabilityReason,
} from "~/server/filters/triggerFilter.matcher";
import type { TriggerFilters } from "~/server/filters/types";

export type AutomationReachabilityReason =
  | TriggerFilterReachabilityReason
  | {
      code: "invalid_filter_query" | "unsupported_filter_query_fields";
      fields: string[];
    };

export interface AutomationReachabilityDiagnostic {
  status: "unreachable";
  reasons: AutomationReachabilityReason[];
}

/**
 * Diagnose only configurations that cannot match, never merely quiet ones.
 * Runtime matcher/compiler code owns every decision; this function only
 * normalises their field-only results for the operator-facing DTO.
 */
export function diagnoseAutomationReachability({
  filters,
  filterQuery,
}: {
  filters: TriggerFilters;
  filterQuery: string | null | undefined;
}): AutomationReachabilityDiagnostic | null {
  const query = filterQuery?.trim();
  let reasons: AutomationReachabilityReason[];

  if (query) {
    const diagnostic = diagnoseFilterQueryReachability(query);
    reasons = diagnostic.invalid
      ? [{ code: "invalid_filter_query", fields: [] }]
      : diagnostic.unsupportedFields.length > 0
        ? [
            {
              code: "unsupported_filter_query_fields",
              fields: diagnostic.unsupportedFields,
            },
          ]
        : [];
  } else {
    reasons = diagnoseTriggerFilterReachability(filters);
  }

  return reasons.length > 0 ? { status: "unreachable", reasons } : null;
}
