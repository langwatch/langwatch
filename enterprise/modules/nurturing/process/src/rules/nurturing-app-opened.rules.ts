// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AppPageOpenedEventData } from "@langwatch/auth-contract";
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";

/**
 * A sessions page open (auth records no other page), against the opening person's own profile,
 * never the organization admin's.
 */
export function appOpenedSignals({
  data,
}: Readonly<{ data: AppPageOpenedEventData }>): NurturingSignal[] {
  const { userId, tenantId, occurredAt, page } = data;
  const base = { sourceEventId: `${userId}:${occurredAt}`, tenantId, occurredAt, userId, page };
  return [
    { kind: "app_opened", ...base },
    { kind: "sessions_page_viewed", ...base },
  ];
}
