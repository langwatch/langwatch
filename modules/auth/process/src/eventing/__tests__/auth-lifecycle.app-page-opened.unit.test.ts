/**
 * @vitest-environment node
 * @see modules/auth/specs/app-page-opened.feature
 */
import { APP_PAGE_OPENED_EVENT_TYPE } from "@langwatch/auth-contract";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { RecordAppPageOpenedCommand } from "../auth-lifecycle.commands.ts";

const AT = Date.UTC(2026, 9, 20, 12);

function record() {
  const [event] = new RecordAppPageOpenedCommand().handle({
    tenantId: createTenantId("user_ada"),
    aggregateId: "user_ada",
    type: "record",
    data: { tenantId: "user_ada", userId: "user_ada", page: "me_sessions", occurredAt: AT },
  });
  if (!event) throw new Error("the command recorded no event");
  return event;
}

describe("RecordAppPageOpenedCommand", () => {
  it("records the lw.auth.app_page_opened event", () => {
    expect(record().type).toBe(APP_PAGE_OPENED_EVENT_TYPE);
  });

  /** @scenario "A repeated page open at one instant is one event" */
  it("keys an open by the person, the page and the instant", () => {
    expect(record().idempotencyKey).toBe(`user_ada:app_page_opened:me_sessions:${AT}`);
  });

  it("records it under the person's aggregate", () => {
    expect(record().aggregateId).toBe("user_ada");
  });
});
