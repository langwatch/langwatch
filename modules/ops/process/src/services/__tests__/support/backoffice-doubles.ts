/**
 * The collaborators the backoffice's organization edit does NOT reach: a
 * legacy single sign-on refusal happens before storage, so the repository
 * records whether it was called at all and the rest throw.
 */
import type { BrowserSessionApi } from "@langwatch/auth-contract";
import type { AdminOperationInput, AdminOperationResult } from "@langwatch/ops-contract";
import type { UserProfile } from "@langwatch/user-contract";
import { vi } from "vitest";

import { AdminBackofficeRepository } from "../../../repositories/admin/admin-backoffice.repository.ts";
import { AdminAuditSink } from "../../impersonation.service.ts";

export const backofficeOperator: UserProfile = {
  id: "olive",
  name: "Olive",
  email: "olive@example.com",
  emailVerified: true,
  image: null,
  pendingSsoSetup: false,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  lastLoginAt: null,
  deactivatedAt: null,
};

export class AuthStub implements BrowserSessionApi {
  /** Auth's cutover half, which nothing here exercises. */
  async retireLegacySsoAccess(): Promise<{ retired: number; remaining: number }> {
    return { retired: 0, remaining: 0 };
  }

  async countLegacySsoAccess(): Promise<number> {
    return 0;
  }

  async listBrowserSessions(): Promise<never[]> {
    return [];
  }
  async endBrowserSession(): Promise<{ ended: number }> {
    return { ended: 0 };
  }
  async isWithinBudget(): Promise<Readonly<{ allowed: boolean }>> {
    return { allowed: false };
  }
  async route(): Promise<never> {
    throw new Error("not configured");
  }
  async addressIsRegistered(): Promise<boolean> {
    return false;
  }
  async requestSignUpVerification(): Promise<void> {}
  async completeSignUpVerification(): Promise<never> {
    throw new Error("not configured");
  }
  async readInviteLanding(): Promise<never> {
    throw new Error("not configured");
  }
  async requestFreshInvite(): Promise<void> {}
  async resolveAuthProvider(): Promise<string> {
    return "email";
  }
  tryVerifyBrowserSession = vi.fn(async () => null);
  tryResolveBrowserSession = vi.fn(async () => null);
  revokeAllBrowserSessions = vi.fn(async () => undefined);
  revokeBrowserSession = vi.fn(async () => undefined);
  revokeOtherBrowserSessions = vi.fn(async () => undefined);

  offersPasskeys(): boolean {
    return false;
  }

  async findCliAccessSession(): Promise<null> {
    return null;
  }

  async revokeCliAccessToken(): Promise<void> {}
}

export class RepositoryStub extends AdminBackofficeRepository {
  execute = vi.fn(async (_input: AdminOperationInput): Promise<AdminOperationResult> => ({
    data: {},
  }));
  findUserById = vi.fn(async () => ({ data: backofficeOperator }));
  setUserDeactivatedAt = vi.fn(async () => undefined);
}

export class AuditStub extends AdminAuditSink {
  record = vi.fn(async () => undefined);
}

export function organizationEdit(data: Record<string, unknown>): AdminOperationInput {
  return {
    resource: "organization",
    method: "update",
    params: { id: "org-acme", data },
    actorId: "olive",
    req: { headers: {} },
  };
}
