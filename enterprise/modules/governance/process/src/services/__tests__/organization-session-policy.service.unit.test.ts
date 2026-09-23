import { SessionPolicyOutOfRangeError } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import {
  OrganizationSessionPolicyRepository,
  type OrganizationSessionPolicy,
} from "../../repositories/session-policy.repository.ts";
import {
  OrganizationSessionPolicyService,
  SESSION_POLICY_MAX_DAYS,
} from "../organization-session-policy.service.ts";

class MemoryRepository extends OrganizationSessionPolicyRepository {
  readonly values = new Map<string, number>();
  find(organizationId: string): Promise<OrganizationSessionPolicy> {
    return Promise.resolve({
      maxSessionDurationDays: this.values.get(organizationId) ?? 0,
    });
  }
  setMaxDurationDays(organizationId: string, maxSessionDurationDays: number): Promise<void> {
    this.values.set(organizationId, maxSessionDurationDays);
    return Promise.resolve();
  }
}

describe("OrganizationSessionPolicyService", () => {
  describe("given a policy that has never been written", () => {
    it("reads the unbounded default", async () => {
      const service = OrganizationSessionPolicyService.create(new MemoryRepository());
      await expect(service.get("org-1")).resolves.toEqual({ maxSessionDurationDays: 0 });
    });
  });

  describe("when setting a value in range", () => {
    it("persists it and returns the new policy", async () => {
      const repository = new MemoryRepository();
      const service = OrganizationSessionPolicyService.create(repository);
      await expect(service.setMaxDurationDays("org-1", 30)).resolves.toEqual({
        maxSessionDurationDays: 30,
      });
      expect(repository.values.get("org-1")).toBe(30);
    });

    it("accepts both bounds — 0 (unbounded) and the maximum", async () => {
      const service = OrganizationSessionPolicyService.create(new MemoryRepository());
      await expect(service.setMaxDurationDays("org-1", 0)).resolves.toEqual({
        maxSessionDurationDays: 0,
      });
      await expect(service.setMaxDurationDays("org-1", SESSION_POLICY_MAX_DAYS)).resolves.toEqual({
        maxSessionDurationDays: SESSION_POLICY_MAX_DAYS,
      });
    });
  });

  describe("when the requested value is out of range", () => {
    it("refuses a negative value without writing", async () => {
      const repository = new MemoryRepository();
      const service = OrganizationSessionPolicyService.create(repository);
      await expect(service.setMaxDurationDays("org-1", -1)).rejects.toBeInstanceOf(
        SessionPolicyOutOfRangeError,
      );
      expect(repository.values.has("org-1")).toBe(false);
    });

    it("refuses one past the cap without writing", async () => {
      const repository = new MemoryRepository();
      const service = OrganizationSessionPolicyService.create(repository);
      await expect(
        service.setMaxDurationDays("org-1", SESSION_POLICY_MAX_DAYS + 1),
      ).rejects.toBeInstanceOf(SessionPolicyOutOfRangeError);
      expect(repository.values.has("org-1")).toBe(false);
    });

    it("refuses a non-integer value — a silent decimal typo does not persist", async () => {
      const repository = new MemoryRepository();
      const service = OrganizationSessionPolicyService.create(repository);
      await expect(service.setMaxDurationDays("org-1", 3.5)).rejects.toBeInstanceOf(
        SessionPolicyOutOfRangeError,
      );
      expect(repository.values.has("org-1")).toBe(false);
    });

    it("names the value and the cap on the refusal so the caller can render it", async () => {
      const service = OrganizationSessionPolicyService.create(new MemoryRepository());
      const refusal = await service
        .setMaxDurationDays("org-1", 9999)
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(SessionPolicyOutOfRangeError);
      expect(refusal).toMatchObject({ value: 9999, maxDays: SESSION_POLICY_MAX_DAYS });
    });
  });
});
