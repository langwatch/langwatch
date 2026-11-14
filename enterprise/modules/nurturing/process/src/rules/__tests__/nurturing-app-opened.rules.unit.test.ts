// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/app-opened.feature
 */
import type { AppPageOpenedEventData } from "@langwatch/auth-contract";
import { describe, expect, it } from "vitest";

import { appOpenedSignals, langyFirstMessageSeenSignal } from "../nurturing-app-opened.rules.ts";
import { fireCodingOrApp } from "../nurturing-coding-delivery.rules.ts";
import { pickCustomerIoDebounce } from "../nurturing-delivery-debounce.rules.ts";

const open = (page: AppPageOpenedEventData["page"]) =>
  ({ tenantId: "user-1", userId: "user-1", page, occurredAt: 1_000 }) as AppPageOpenedEventData;

describe("appOpenedSignals", () => {
  /** @scenario "An app open identifies app_last_opened_at and tracks sessions_page_viewed on the opening user" */
  it("raises sessions_page_viewed for the sessions page", () => {
    expect(appOpenedSignals({ data: open("me_sessions") }).map(({ kind }) => kind)).toEqual([
      "app_opened",
      "sessions_page_viewed",
    ]);
  });

  /** @scenario "Any tracked page open identifies app_last_opened_at" */
  it.each([
    "me_sessions",
    "me_overview",
    "settings_usage",
    "settings_plans",
    "settings_subscription",
    "governance_costs",
  ] as const)("raises app_opened first for %s", (page) => {
    expect(appOpenedSignals({ data: open(page) })[0]).toMatchObject({
      kind: "app_opened",
      userId: "user-1",
    });
  });

  /** @scenario "A usage, cost or plan page open identifies usage_page_viewed_at on the opening user" */
  it.each([
    "me_overview",
    "settings_usage",
    "settings_plans",
    "settings_subscription",
    "governance_costs",
  ] as const)("raises the usage page signals for %s", (page) => {
    expect(appOpenedSignals({ data: open(page) }).map(({ kind }) => kind)).toEqual([
      "app_opened",
      "usage_page_opened",
      "usage_page_viewed",
    ]);
  });

  /** @scenario "Other pages do not set usage_page_viewed_at" */
  it("raises no usage page signal for the sessions page", () => {
    const kinds = appOpenedSignals({ data: open("me_sessions") }).map(({ kind }) => kind);

    expect(kinds).not.toContain("usage_page_opened");
    expect(kinds).not.toContain("usage_page_viewed");
  });
});

describe("langyFirstMessageSeenSignal", () => {
  const signal = langyFirstMessageSeenSignal({
    data: { tenantId: "project-1", occurredAt: 1_000, userId: "user-1", conversationId: "c-1" },
  });

  /** @scenario "Langy's first answer to a person sets saw_langy_first_message on them, once" */
  it("identifies saw_langy_first_message on the person, never on the project", () => {
    expect(fireCodingOrApp(signal)).toEqual([
      { type: "identify", userId: "user-1", traits: { saw_langy_first_message: true } },
    ]);
  });

  /** @scenario "Langy's first answer to a person sets saw_langy_first_message on them, once" */
  it("claims the send once per person, whichever project raised it", () => {
    expect(pickCustomerIoDebounce(signal)).toMatchObject({
      claimKey: "nurturing:once:langy_first_message_seen:user-1",
    });
  });
});
