/** @vitest-environment node */

/**
 * The typed imperative facade (ADR-092 decision 25): the scope argument is
 * derived from the permission's registry tiers, and the service decides
 * through the injected decision repository — the same one the declared
 * `.permission()` seam composes. The `@ts-expect-error` lines are
 * compile-time assertions enforced by `pnpm typecheck:tests`.
 */
import { PermissionDeniedError } from "@langwatch/authz";
import { describe, expect, it, vi } from "vitest";

import type { CredentialDecisionRepository } from "../credential-decision.repository";
import type { PermissionDecisionRepository } from "../permission-decision.repository";
import { PermissionsService } from "../permissions.service";

const repository = {
  findProjectDecision: vi.fn(),
  findProjectAnyDecision: vi.fn(),
  findTeamDecision: vi.fn(),
  findOrganizationDecision: vi.fn(),
} satisfies PermissionDecisionRepository;

const credentials = {
  findApiKeyDecision: vi.fn(),
  findProjectScope: vi.fn(),
} satisfies CredentialDecisionRepository;

const service = new PermissionsService({ decisions: repository, credentials });

describe("PermissionsService typed facade", () => {
  describe("when an imperative check names its scope id", () => {
    /** @scenario "An imperative check names its scope id to match the permission" */
    it("decides through the tier's repository method", async () => {
      repository.findProjectDecision.mockResolvedValue({
        permitted: true,
        organizationRole: "MEMBER",
      });
      await expect(
        service.hasPermission({
          userId: "alice",
          permission: "traces:view",
          projectId: "proj-1",
        }),
      ).resolves.toBe(true);
      expect(repository.findProjectDecision).toHaveBeenCalledWith({
        userId: "alice",
        projectId: "proj-1",
        permission: "traces:view",
      });

      repository.findOrganizationDecision.mockResolvedValue({
        permitted: false,
        organizationRole: null,
      });
      await expect(
        service.requirePermission({
          userId: "alice",
          permission: "organization:manage",
          organizationId: "org-1",
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });

    it("refuses tier-mismatched scope ids at compile time", () => {
      void service.hasPermission({
        userId: "alice",
        permission: "governance:view",
        // @ts-expect-error — governance is organization-only; a projectId is a category error
        projectId: "proj-1",
      });
      // @ts-expect-error — exactly one scope id: two at once is ambiguous
      void service.hasPermission({
        userId: "alice",
        permission: "traces:view",
        projectId: "proj-1",
        organizationId: "org-1",
      });
      // @ts-expect-error — ops is platform-tier; no scope id can address it
      void service.hasPermission({
        userId: "alice",
        permission: "ops:view",
        organizationId: "org-1",
      });
      expect(true).toBe(true);
    });
  });
});
