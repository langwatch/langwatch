// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { BillingReportOrganizationLookup } from "./billing-report-organization.repository.ts";

const ONE_MINUTE_MS = 60 * 1000;

/**
 * How long a billing organization read stays good, and the key prefix it is
 * stored under. Both were the constructor arguments of the process-wide cache
 * this command used to build for itself; they are the cache's identity across
 * every pod, so they stay pinned here and the store is injected.
 */
export const BILLING_ORG_CACHE_TTL_MS = ONE_MINUTE_MS;
export const BILLING_ORG_CACHE_PREFIX = "ttlcache:billing:orgData:";

/**
 * The shared read-through cache for billing organization lookups.
 *
 * Structural, and deliberately narrow: the process owns whether this is
 * Redis-backed (shared across pods) or in-memory, and the command only reads
 * and writes one key per organization.
 *
 * The whole VERDICT is cached, not just a hit, so a skip costs the same as
 * anything else on a second pass within the window. Worth knowing what that
 * does and does not buy: the window is one minute and the dispatch driving
 * this handler is suppressed to one per organization per five, so in the
 * steady state the entry has expired before the next command arrives and the
 * query runs regardless. What it saves is the bursts, where two commands for
 * one organization land together — the grace window at the start of a month
 * dispatches the previous month alongside the current one, and those carry
 * different dedup keys, so both run.
 */
export interface BillingOrganizationCache {
  get(key: string): Promise<BillingReportOrganizationLookup | undefined>;
  set(key: string, value: BillingReportOrganizationLookup): Promise<void>;
}
