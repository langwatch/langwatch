import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  assertMemberTypeLimitNotExceeded,
  LICENSE_LIMIT_ERRORS,
  type MemberTypeLimits,
} from "../license-limit-guard";
import type { ILicenseEnforcementRepository } from "../license-enforcement.repository";

describe("assertMemberTypeLimitNotExceeded", () => {
  const organizationId = "org_123";

  function createMockRepo(
    memberCount = 0,
    membersLiteCount = 0
  ): ILicenseEnforcementRepository {
    return {
      getMemberCount: vi.fn().mockResolvedValue(memberCount),
      getMembersLiteCount: vi.fn().mockResolvedValue(membersLiteCount),
      getWorkflowCount: vi.fn(),
      getPromptCount: vi.fn(),
      getEvaluatorCount: vi.fn(),
      getScenarioCount: vi.fn(),
      getProjectCount: vi.fn(),
      getTeamCount: vi.fn(),
      getAgentCount: vi.fn(),
      getExperimentCount: vi.fn(),
      getOnlineEvaluationCount: vi.fn(),
      getEvaluationsCreditUsed: vi.fn(),
      getCurrentMonthCost: vi.fn(),
      getCurrentMonthCostForProjects: vi.fn(),
    };
  }

  function createLimits(
    maxMembers = 5,
    maxMembersLite = 10,
    overrideAddingLimitations = false
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
        limits
      );

      expect(mockRepo.getMemberCount).not.toHaveBeenCalled();
      expect(mockRepo.getMembersLiteCount).not.toHaveBeenCalled();
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
        limits
      );

      expect(mockRepo.getMemberCount).not.toHaveBeenCalled();
      expect(mockRepo.getMembersLiteCount).not.toHaveBeenCalled();
    });
  });

  describe("when changeType is lite-to-full", () => {
    it("allows change when under limit", async () => {
      const mockRepo = createMockRepo(3); // 3 members, limit is 5
      const limits = createLimits(5);

      await expect(
        assertMemberTypeLimitNotExceeded(
          "lite-to-full",
          organizationId,
          mockRepo,
          limits
        )
      ).resolves.toBeUndefined();

      expect(mockRepo.getMemberCount).toHaveBeenCalledWith(organizationId);
    });

    it("throws when at limit", async () => {
      const mockRepo = createMockRepo(5); // 5 members, limit is 5
      const limits = createLimits(5);

      await expect(
        assertMemberTypeLimitNotExceeded(
          "lite-to-full",
          organizationId,
          mockRepo,
          limits
        )
      ).rejects.toThrow(
        expect.objectContaining({
          code: "FORBIDDEN",
          message: LICENSE_LIMIT_ERRORS.FULL_MEMBER_LIMIT,
        })
      );
    });

    it("throws when over limit", async () => {
      const mockRepo = createMockRepo(10); // 10 members, limit is 5
      const limits = createLimits(5);

      await expect(
        assertMemberTypeLimitNotExceeded(
          "lite-to-full",
          organizationId,
          mockRepo,
          limits
        )
      ).rejects.toThrow(TRPCError);
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
          limits
        )
      ).resolves.toBeUndefined();

      expect(mockRepo.getMembersLiteCount).toHaveBeenCalledWith(organizationId);
    });

    it("throws when at limit", async () => {
      const mockRepo = createMockRepo(0, 10); // 10 lite members, limit is 10
      const limits = createLimits(5, 10);

      await expect(
        assertMemberTypeLimitNotExceeded(
          "full-to-lite",
          organizationId,
          mockRepo,
          limits
        )
      ).rejects.toThrow(
        expect.objectContaining({
          code: "FORBIDDEN",
          message: LICENSE_LIMIT_ERRORS.MEMBER_LITE_LIMIT,
        })
      );
    });

    it("throws when over limit", async () => {
      const mockRepo = createMockRepo(0, 15); // 15 lite members, limit is 10
      const limits = createLimits(5, 10);

      await expect(
        assertMemberTypeLimitNotExceeded(
          "full-to-lite",
          organizationId,
          mockRepo,
          limits
        )
      ).rejects.toThrow(TRPCError);
    });
  });
});
