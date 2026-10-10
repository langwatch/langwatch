/** @see specs/identity/domain-auto-join.feature */
import { describe, expect, it, vi } from "vitest";

import { SsoArrivalNoticeService } from "../sso-arrival-notice.service.ts";

function build() {
  const joinedAutomatically = vi.fn<() => Promise<void>>().mockResolvedValue();
  return {
    joinedAutomatically,
    service: SsoArrivalNoticeService.create({ notifier: { joinedAutomatically } }),
  };
}

describe("SsoArrivalNoticeService", () => {
  /** @scenario "An automatic SSO admission's notice reaches the administrators' mail" */
  it("sends a Full member's notice keyed by the admission grant", async () => {
    const { service, joinedAutomatically } = build();

    await service.joinedAutomatically({
      organizationId: "org_1",
      requesterUserId: "user_1",
      domain: "acme.com",
      admissionId: "grant_1",
    });

    expect(joinedAutomatically).toHaveBeenCalledWith({
      joinRequestId: "grant_1",
      organizationId: "org_1",
      requesterUserId: "user_1",
      domain: "acme.com",
    });
  });

  /** @scenario "An automatic SSO admission's notice reaches the administrators' mail" */
  it("keys a Developer seat's notice by organization, person and domain", async () => {
    const { service, joinedAutomatically } = build();

    await service.joinedAutomatically({
      organizationId: "org_1",
      requesterUserId: "user_1",
      domain: "acme.com",
    });

    expect(joinedAutomatically).toHaveBeenCalledWith(
      expect.objectContaining({ joinRequestId: "automatic:org_1:user_1:acme.com" }),
    );
  });
});
