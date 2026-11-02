// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/app-opened.feature
 */
import type { AppPageOpenedEventData } from "@langwatch/auth-contract";
import { describe, expect, it } from "vitest";

import { appOpenedSignals } from "../nurturing-app-opened.rules.ts";

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
});
