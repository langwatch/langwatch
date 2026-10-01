// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { senderAddressHeadersSchema } from "@langwatch/enterprise-saas-contract";

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

/** The proxy headers that name a sender's address, most specific first. */
const ADDRESS_HEADERS = Object.keys(senderAddressHeadersSchema.shape);

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;

/** The first well-formed address the headers name; empty where none does. */
export function senderAddressesOf(headers: Readonly<Record<string, string | undefined>>): string[] {
  for (const name of ADDRESS_HEADERS) {
    const candidate = (headers[name]?.split(",")[0] ?? "").replace(/^::ffff:/, "").trim();
    if (IPV4.test(candidate) || IPV6.test(candidate)) return [candidate];
  }

  return [];
}
