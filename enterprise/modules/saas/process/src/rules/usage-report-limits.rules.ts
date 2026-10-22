// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * How often the usage-report receiver answers. An install reports once per
 * organization per day, so these stay generous for real traffic. The address
 * and the instance id are the caller's to choose, so the global cap is the bound.
 */
export const USAGE_REPORT_GLOBAL_LIMIT = { requests: 500, seconds: 60 } as const;
export const USAGE_REPORT_PER_ADDRESS_LIMIT = { requests: 10, seconds: 60 } as const;
export const USAGE_REPORT_PER_INSTANCE_LIMIT = { requests: 5, seconds: 3600 } as const;

export const USAGE_REPORT_GLOBAL_KEY = "track_usage:global";

export function usageReportAddressKey(address: string): string {
  return `track_usage:ip:${address}`;
}

export function usageReportInstanceKey(instanceId: string): string {
  return `track_usage:instance:${instanceId}`;
}
