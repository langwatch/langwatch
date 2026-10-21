// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/app-opened.feature
 */
import type { AppPageOpenedEventData } from "@langwatch/auth-contract";
import { describe, expect, it } from "vitest";

import { appOpenedSignals } from "../nurturing-app-opened.rules.ts";

const open = (page: string) =>
  ({ tenantId: "user-1", userId: "user-1", page, occurredAt: 1_000 }) as AppPageOpenedEventData;

describe("appOpenedSignals", () => {
  /** @scenario "Only the sessions page raises sessions_page_viewed" */
  it("raises sessions_page_viewed for the sessions page", () => {
    expect(appOpenedSignals({ data: open("me_sessions") }).map(({ kind }) => kind)).toEqual([
      "app_opened",
      "sessions_page_viewed",
    ]);
  });

  /** @scenario "Only the sessions page raises sessions_page_viewed" */
  it("raises only app_opened for any other page", () => {
    expect(appOpenedSignals({ data: open("elsewhere") }).map(({ kind }) => kind)).toEqual([
      "app_opened",
    ]);
  });
});
