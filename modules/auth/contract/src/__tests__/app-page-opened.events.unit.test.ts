/**
 * @vitest-environment node
 * @see modules/auth/specs/app-page-opened.feature
 */
import { APP_PAGE_OPENED_EVENT_TYPE, appPageOpenedEventDataSchema } from "@langwatch/auth-contract";
import { describe, expect, it } from "vitest";

const data = { tenantId: "user-1", userId: "user-1", page: "me_sessions", occurredAt: 1_000 };

describe("the app-page-opened fact", () => {
  it("is named lw.auth.app_page_opened", () => {
    expect(APP_PAGE_OPENED_EVENT_TYPE).toBe("lw.auth.app_page_opened");
  });

  /** @scenario "The app-page-opened fact carries ids, the page and the time only" */
  it("names exactly tenantId, userId, page and occurredAt", () => {
    expect(Object.keys(appPageOpenedEventDataSchema.shape).toSorted()).toEqual([
      "occurredAt",
      "page",
      "tenantId",
      "userId",
    ]);
  });

  it("accepts the sessions page", () => {
    expect(appPageOpenedEventDataSchema.validate(data)).toBe(true);
  });

  it("rejects a page it does not name", () => {
    expect(appPageOpenedEventDataSchema.validate({ ...data, page: "elsewhere" })).toBe(false);
  });
});
