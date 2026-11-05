/**
 * @vitest-environment node
 * @see modules/auth/specs/app-page-opened.feature
 */
import { describe, expect, it, vi } from "vitest";

import { AuthLifecycleNoticeService } from "../auth-lifecycle-notice.service.ts";

describe("auth's app-page-opened notice", () => {
  it("records an open under the person, ids and page only", async () => {
    const sent: unknown[] = [];
    const send = async (data: unknown) => void sent.push(data);
    const service = AuthLifecycleNoticeService.create({ reportError: vi.fn() });
    service.connect({
      recordSessionStarted: { send },
      recordSsoAutoAdded: { send },
      recordSignedUp: { send },
      recordAppPageOpened: { send },
    });

    service.appPageOpened({ userId: "user_ada", page: "me_sessions" });
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    expect(sent).toEqual([
      {
        tenantId: "user_ada",
        userId: "user_ada",
        page: "me_sessions",
        occurredAt: expect.any(Number),
      },
    ]);
  });
});
