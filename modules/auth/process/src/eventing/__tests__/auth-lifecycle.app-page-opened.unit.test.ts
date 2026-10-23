/**
 * @vitest-environment node
 * @see modules/auth/specs/app-page-opened.feature
 */
import { APP_PAGE_OPENED_EVENT_TYPE } from "@langwatch/auth-contract";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { RecordAppPageOpenedCommand } from "../auth-lifecycle.commands.ts";

const AT = Date.UTC(2026, 9, 20, 12);

function record(occurredAt = AT) {
  const [event] = new RecordAppPageOpenedCommand().handle({
    tenantId: createTenantId("user_ada"),
    aggregateId: "user_ada",
    type: "record",
    data: { tenantId: "user_ada", userId: "user_ada", page: "me_sessions", occurredAt },
  });
  if (!event) throw new Error("the command recorded no event");
  return event;
}

describe("RecordAppPageOpenedCommand", () => {
  it("records the lw.auth.app_page_opened event", () => {
    expect(record().type).toBe(APP_PAGE_OPENED_EVENT_TYPE);
  });

  /** @scenario "A repeated page open inside an hour is one event" */
  it("keys an open by the person, the page and the UTC hour", () => {
    expect(record().idempotencyKey).toBe(
      `user_ada:app_page_opened:me_sessions:${Math.floor(AT / 3_600_000)}`,
    );
  });

  it("keys two opens in one hour alike and an open in the next hour apart", () => {
    expect(record(AT + 59 * 60_000).idempotencyKey).toBe(record(AT).idempotencyKey);
    expect(record(AT + 3_600_000).idempotencyKey).not.toBe(record(AT).idempotencyKey);
  });

  it("records it under the person's aggregate", () => {
    expect(record().aggregateId).toBe("user_ada");
  });
});
