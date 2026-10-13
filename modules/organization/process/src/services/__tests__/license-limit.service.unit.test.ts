import type { LimitCheckResult } from "@langwatch/organization-contract";
/**
 * @vitest-environment node
 *
 * The `licenseEnforcement.*` answers: a limit read, every limit at once, and
 * the report a client files when its pre-check refused somebody.
 * @see specs/licensing/enforcement-members.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecordSeatLimitReachedCommandData } from "../../eventing/seat-limit.events.ts";
import { LicenseLimitService } from "../license-limit.service.ts";
import type { OrganizationSeatLicense } from "../organization-seat-license.service.ts";
import type { OrganizationSignals } from "../organization-signals.service.ts";
import { SeatLimitNoticeService } from "../seat-limit-notice.service.ts";

const ORGANIZATION = "org_acme";
const ANA = { id: "user_ana", name: "Ana", email: "ana@acme.com" };

const checkLimit = vi.fn<OrganizationSeatLicense["checkLimit"]>();
const send = vi.fn<(data: RecordSeatLimitReachedCommandData) => Promise<void>>();
const reportError = vi.fn<OrganizationSignals["reportError"]>();

const notices = SeatLimitNoticeService.create({
  signals: createApiFixture<OrganizationSignals>({ reportError }),
});
notices.connect({ send });
const limits = LicenseLimitService.create({
  seats: createApiFixture<OrganizationSeatLicense>({ checkLimit }),
  notices,
});

function answer(result: Partial<LimitCheckResult> = {}): LimitCheckResult {
  return { allowed: true, current: 1, max: 5, limitType: "members", ...result };
}

describe("the licence limit answers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    send.mockResolvedValue(undefined);
  });

  describe("when a limit is read", () => {
    it("asks about the caller, not only the organization", async () => {
      checkLimit.mockResolvedValue(answer({ current: 3 }));

      await expect(
        limits.check({ organizationId: ORGANIZATION, limitType: "members" }, ANA),
      ).resolves.toEqual({ allowed: true, current: 3, max: 5, limitType: "members" });
      expect(checkLimit).toHaveBeenCalledWith({
        organizationId: ORGANIZATION,
        resource: "members",
        user: ANA,
      });
    });

    /** @scenario "Every enforced limit is answered at once, keyed by limit type" */
    it("answers every limit at once, keyed by limit type", async () => {
      checkLimit.mockImplementation(async ({ resource }) =>
        answer({ limitType: resource, allowed: resource === "members" }),
      );

      const all = await limits.checkAll({ organizationId: ORGANIZATION }, ANA);

      expect(Object.keys(all).toSorted()).toEqual(["members", "membersLite"]);
      expect(all.members.allowed).toBe(true);
      expect(all.membersLite.allowed).toBe(false);
    });
  });

  describe("when a client reports that its pre-check blocked somebody", () => {
    /** @scenario "A blocked pre-check raises a limit notice once the server agrees" */
    /** @scenario "A confirmed blocked report records organization's seat-limit event" */
    it("records organization's seat-limit event once the server agrees", async () => {
      checkLimit.mockResolvedValue(answer({ allowed: false, current: 5 }));

      await limits.reportBlocked({ organizationId: ORGANIZATION, limitType: "members" }, ANA);

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: ORGANIZATION,
          organizationId: ORGANIZATION,
          limitType: "members",
          current: 5,
          max: 5,
        }),
      );
    });

    /** @scenario "A fabricated blocked report raises nothing" */
    it("stays silent when the ceiling was not reached", async () => {
      checkLimit.mockResolvedValue(answer());

      await limits.reportBlocked({ organizationId: ORGANIZATION, limitType: "members" }, ANA);

      expect(send).not.toHaveBeenCalled();
    });

    /** @scenario "A limit notice that fails is reported, never thrown" */
    it("reports a failed notice instead of failing the report", async () => {
      checkLimit.mockResolvedValue(answer({ allowed: false, current: 5 }));
      const failure = new Error("notice transport unavailable");
      send.mockRejectedValue(failure);

      await expect(
        limits.reportBlocked({ organizationId: ORGANIZATION, limitType: "members" }, ANA),
      ).resolves.toBeUndefined();

      await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(failure));
    });
  });
});
