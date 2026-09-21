import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXPIRED_LICENSE_KEY } from "../../../../ee/licensing/__tests__/fixtures/testLicenses";
import { floorAtOssBaseline } from "../../../../ee/licensing/ossBaselineFloor";
import { mapToPlanInfo } from "../../../../ee/licensing/planMapping";
import { parseLicenseKey } from "../../../../ee/licensing/validation";
import { LimitExceededError } from "../errors";
import type { ILicenseEnforcementRepository } from "../license-enforcement.repository";
import {
  assertMemberTypeLimitNotExceeded,
  type MemberTypeLimits,
} from "../license-limit-guard";

const { mockNotifyResourceLimitReached, mockCaptureException } = vi.hoisted(
  () => ({
    mockNotifyResourceLimitReached: vi.fn().mockResolvedValue(undefined),
    mockCaptureException: vi.fn(),
  }),
);

vi.mock("~/server/app-layer/app", () => ({
  // Consumers that degrade without Redis read through this one.
  tryGetApp: () => null,
  getApp: () => ({
    usageLimits: {
      notifyResourceLimitReached: mockNotifyResourceLimitReached,
    },
  }),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: mockCaptureException,
  toError: vi.fn((e) => (e instanceof Error ? e : new Error(String(e)))),
}));

describe("assertMemberTypeLimitNotExceeded", () => {
  const organizationId = "org_123";

  beforeEach(() => {
    mockNotifyResourceLimitReached.mockClear();
    mockCaptureException.mockClear();
  });

  function createMockRepo(
    memberCount = 0,
    membersLiteCount = 0,
  ): ILicenseEnforcementRepository {
    return {
      getMemberCount: vi.fn().mockResolvedValue(memberCount),
      getMembersLiteCount: vi.fn().mockResolvedValue(membersLiteCount),
      getCurrentMonthCost: vi.fn(),
      getCurrentMonthCostForProjects: vi.fn(),
    };
  }

  function createLimits(
    maxMembers = 5,
    maxMembersLite = 10,
    overrideAddingLimitations = false,
  ): MemberTypeLimits {
    return { maxMembers, maxMembersLite, overrideAddingLimitations };
  }

  describe("when changeType is no-change", () => {
    it("does not check limits", async () => {
      const mockRepo = createMockRepo();
      const limits = createLimits();

      await assertMemberTypeLimitNotExceeded(
        "no-change",
        organizationId,
        mockRepo,
        limits,
      );

      expect(mockRepo.getMemberCount).not.toHaveBeenCalled();
      expect(mockRepo.getMembersLiteCount).not.toHaveBeenCalled();
    });

    it("does not send notification", async () => {
      const mockRepo = createMockRepo();
      const limits = createLimits();

      await assertMemberTypeLimitNotExceeded(
        "no-change",
        organizationId,
        mockRepo,
        limits,
      );

      expect(mockNotifyResourceLimitReached).not.toHaveBeenCalled();
    });
  });

  describe("when overrideAddingLimitations is true", () => {
    it("does not check limits", async () => {
      const mockRepo = createMockRepo();
      const limits = createLimits(5, 10, true);

      await assertMemberTypeLimitNotExceeded(
        "lite-to-full",
        organizationId,
        mockRepo,
        limits,
      );

      expect(mockRepo.getMemberCount).not.toHaveBeenCalled();
      expect(mockRepo.getMembersLiteCount).not.toHaveBeenCalled();
    });

    it("does not send notification", async () => {
      const mockRepo = createMockRepo();
      const limits = createLimits(5, 10, true);

      await assertMemberTypeLimitNotExceeded(
        "lite-to-full",
        organizationId,
        mockRepo,
        limits,
      );

      expect(mockNotifyResourceLimitReached).not.toHaveBeenCalled();
    });
  });

  describe("when changeType is lite-to-full", () => {
    /** @scenario Allows upgrade from Lite Member to full member when under limit */
    it("allows change when under limit", async () => {
      const mockRepo = createMockRepo(3); // 3 members, limit is 5
      const limits = createLimits(5);

      await expect(
        assertMemberTypeLimitNotExceeded(
          "lite-to-full",
          organizationId,
          mockRepo,
          limits,
        ),
      ).resolves.toBeUndefined();

      expect(mockRepo.getMemberCount).toHaveBeenCalledWith(organizationId);
    });

    it("does not send notification when under limit", async () => {
      const mockRepo = createMockRepo(3);
      const limits = createLimits(5);

      await assertMemberTypeLimitNotExceeded(
        "lite-to-full",
        organizationId,
        mockRepo,
        limits,
      );

      expect(mockNotifyResourceLimitReached).not.toHaveBeenCalled();
    });

    /** @scenario Blocks upgrade from Lite Member to full member when at member limit */
    it("throws when at limit", async () => {
      const mockRepo = createMockRepo(5); // 5 members, limit is 5
      const limits = createLimits(5);

      const error = await assertMemberTypeLimitNotExceeded(
        "lite-to-full",
        organizationId,
        mockRepo,
        limits,
      ).catch((e) => e);

      // The allowance travels as `meta` under a stable code, which is what lets
      // the client name which seats ran out. Asserting the code rather than the
      // sentence: the sentence is copy.
      expect(error).toMatchObject({
        code: "resource_limit_exceeded",
        httpStatus: 403,
        meta: {
          limitType: "members",
          current: 5,
          max: 5,
        },
      });
    });

    it("sends notification when at limit", async () => {
      const mockRepo = createMockRepo(5);
      const limits = createLimits(5);

      await assertMemberTypeLimitNotExceeded(
        "lite-to-full",
        organizationId,
        mockRepo,
        limits,
      ).catch(() => {});

      expect(mockNotifyResourceLimitReached).toHaveBeenCalledWith({
        organizationId,
        limitType: "members",
        current: 5,
        max: 5,
      });
    });

    it("throws when over limit", async () => {
      const mockRepo = createMockRepo(10); // 10 members, limit is 5
      const limits = createLimits(5);

      await expect(
        assertMemberTypeLimitNotExceeded(
          "lite-to-full",
          organizationId,
          mockRepo,
          limits,
        ),
      ).rejects.toThrow(LimitExceededError);
    });
  });

  describe("when changeType is full-to-lite", () => {
    it("allows change when under limit", async () => {
      const mockRepo = createMockRepo(0, 5); // 5 lite members, limit is 10
      const limits = createLimits(5, 10);

      await expect(
        assertMemberTypeLimitNotExceeded(
          "full-to-lite",
          organizationId,
          mockRepo,
          limits,
        ),
      ).resolves.toBeUndefined();

      expect(mockRepo.getMembersLiteCount).toHaveBeenCalledWith(organizationId);
    });

    it("does not send notification when under limit", async () => {
      const mockRepo = createMockRepo(0, 5);
      const limits = createLimits(5, 10);

      await assertMemberTypeLimitNotExceeded(
        "full-to-lite",
        organizationId,
        mockRepo,
        limits,
      );

      expect(mockNotifyResourceLimitReached).not.toHaveBeenCalled();
    });

    it("throws when at limit", async () => {
      const mockRepo = createMockRepo(0, 10); // 10 lite members, limit is 10
      const limits = createLimits(5, 10);

      const error = await assertMemberTypeLimitNotExceeded(
        "full-to-lite",
        organizationId,
        mockRepo,
        limits,
      ).catch((e) => e);

      expect(error).toMatchObject({
        code: "resource_limit_exceeded",
        httpStatus: 403,
        meta: {
          limitType: "membersLite",
          current: 10,
          max: 10,
        },
      });
    });

    it("sends notification when at limit", async () => {
      const mockRepo = createMockRepo(0, 10);
      const limits = createLimits(5, 10);

      await assertMemberTypeLimitNotExceeded(
        "full-to-lite",
        organizationId,
        mockRepo,
        limits,
      ).catch(() => {});

      expect(mockNotifyResourceLimitReached).toHaveBeenCalledWith({
        organizationId,
        limitType: "membersLite",
        current: 10,
        max: 10,
      });
    });

    it("throws when over limit", async () => {
      const mockRepo = createMockRepo(0, 15); // 15 lite members, limit is 10
      const limits = createLimits(5, 10);

      await expect(
        assertMemberTypeLimitNotExceeded(
          "full-to-lite",
          organizationId,
          mockRepo,
          limits,
        ),
      ).rejects.toThrow(LimitExceededError);
    });
  });

  describe("when the organization's license reached its end date", () => {
    /** @scenario Adding a member is refused once a lapsed license is full */
    it("refuses the next full member on the seats the lapsed license sold", async () => {
      // The plan a lapsed license resolves to, built the way production builds
      // it: the signed payload mapped to a plan, then floored at the
      // open-source baseline. Seats are the one thing the floor leaves alone,
      // so they are still what arms this guard.
      const lapsed = parseLicenseKey(EXPIRED_LICENSE_KEY);
      if (!lapsed) throw new Error("Expected the expired fixture to parse");
      const plan = floorAtOssBaseline(mapToPlanInfo(lapsed.data));
      const mockRepo = createMockRepo(plan.maxMembers);

      await expect(
        assertMemberTypeLimitNotExceeded(
          "lite-to-full",
          organizationId,
          mockRepo,
          plan,
        ),
      ).rejects.toMatchObject({
        code: "resource_limit_exceeded",
        meta: { limitType: "members" },
      });
    });

    it("still allows a full member while a seat is free", async () => {
      const lapsed = parseLicenseKey(EXPIRED_LICENSE_KEY);
      if (!lapsed) throw new Error("Expected the expired fixture to parse");
      const plan = floorAtOssBaseline(mapToPlanInfo(lapsed.data));
      const mockRepo = createMockRepo(plan.maxMembers - 1);

      await expect(
        assertMemberTypeLimitNotExceeded(
          "lite-to-full",
          organizationId,
          mockRepo,
          plan,
        ),
      ).resolves.toBeUndefined();
    });
  });
});
