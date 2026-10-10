/**
 * @vitest-environment node
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { describe, expect, it, vi } from "vitest";

import { AuthLifecycleNoticeService } from "../auth-lifecycle-notice.service.ts";

function notices(send: (data: unknown) => Promise<void>) {
  const reportError = vi.fn();
  const service = AuthLifecycleNoticeService.create({ reportError });
  service.connect({
    recordSessionStarted: { send },
    recordSsoAutoAdded: { send },
    recordSignedUp: { send },
  });
  return { service, reportError };
}

describe("auth's lifecycle notices", () => {
  it("records a sign-up under the person, ids only", async () => {
    const sent: unknown[] = [];
    const { service } = notices(async (data) => {
      sent.push(data);
    });

    service.signedUp({ userId: "user_ada" });
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    expect(sent).toEqual([
      { tenantId: "user_ada", userId: "user_ada", occurredAt: expect.any(Number) },
    ]);
  });

  it("records a session under the person and an auto-join under the organization, ids only", async () => {
    const sent: unknown[] = [];
    const { service } = notices(async (data) => {
      sent.push(data);
    });

    service.sessionStarted({ userId: "user_ada" });
    service.ssoAutoAdded({
      userId: "user_ada",
      organizationId: "org_acme",
      organizationName: "Acme",
    });
    await vi.waitFor(() => expect(sent).toHaveLength(2));

    expect(sent).toEqual([
      { tenantId: "user_ada", userId: "user_ada", occurredAt: expect.any(Number) },
      {
        tenantId: "org_acme",
        userId: "user_ada",
        organizationId: "org_acme",
        organizationName: "Acme",
        occurredAt: expect.any(Number),
      },
    ]);
  });

  /** @scenario "Activity tracking failure does not break the login flow" */
  it("reports a failed record and never throws into the sign-in", async () => {
    const failure = new Error("event store unavailable");
    const { service, reportError } = notices(async () => {
      throw failure;
    });

    expect(() => service.sessionStarted({ userId: "user_ada" })).not.toThrow();
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(failure));
  });

  it("reports, rather than throws, when the pipeline is not registered in this process", () => {
    const reportError = vi.fn();
    const service = AuthLifecycleNoticeService.create({ reportError });

    expect(() =>
      service.ssoAutoAdded({
        userId: "user_ada",
        organizationId: "org_acme",
        organizationName: "Acme",
      }),
    ).not.toThrow();
    expect(reportError).toHaveBeenCalledOnce();
  });
});
