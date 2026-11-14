// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AppPageOpenedEventData } from "@langwatch/auth-contract";
import type { NurturingSignal, NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";
import type { LangyFirstMessageSeenEventData } from "@langwatch/langy-contract";

/**
 * A page open, against the opening person's own profile,
 * never the organization admin's. Any tracked page open is an app open.
 */
export function appOpenedSignals({
  data,
}: Readonly<{ data: AppPageOpenedEventData }>): NurturingSignal[] {
  const { userId, tenantId, occurredAt, page } = data;
  const base = { sourceEventId: `${userId}:${occurredAt}`, tenantId, occurredAt, userId, page };
  return [{ kind: "app_opened", ...base }, ...pageSignals(page, base)];
}

function pageSignals(
  page: AppPageOpenedEventData["page"],
  base: Omit<NurturingSignalOf<"app_opened">, "kind">,
): NurturingSignal[] {
  switch (page) {
    case "me_sessions":
      return [{ kind: "sessions_page_viewed", ...base }];
    case "me_overview":
    case "settings_usage":
    case "settings_plans":
    case "settings_subscription":
    case "governance_costs":
      return [
        { kind: "usage_page_opened", ...base },
        { kind: "usage_page_viewed", ...base },
      ];
    default:
      return page satisfies never;
  }
}

/** Langy's first-answer fact as the person's signal; the person, never the conversation's words. */
export function langyFirstMessageSeenSignal({
  data,
}: Readonly<{
  data: LangyFirstMessageSeenEventData;
}>): NurturingSignalOf<"langy_first_message_seen"> {
  const { userId, tenantId, occurredAt } = data;
  return {
    kind: "langy_first_message_seen",
    sourceEventId: `langy-first-message-seen:${userId}`,
    tenantId,
    occurredAt,
    userId,
  };
}
