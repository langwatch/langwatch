/**
 * The collaborators the backoffice's organization edit does NOT reach: a
 * legacy single sign-on refusal happens before storage, so the repository
 * records whether it was called at all and the rest throw.
 */
import { AuthService } from "@langwatch/auth-contract";
import type { AdminOperationInput, AdminOperationResult } from "@langwatch/ops-contract";
import { UserService, type UserProfile } from "@langwatch/user-contract";
import { vi } from "vitest";
import { AdminBackofficeRepository } from "../../../repositories/admin-backoffice.repository";
import { AdminAuditSink } from "../../impersonation.service";

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

const notReached = async (): Promise<never> => {
  throw new Error("not reached by an organization edit");
};

export class UsersStub extends UserService {
  getProfiles = vi.fn(async () => []);
  tryFindById = vi.fn(async () => backofficeOperator);
  tryFindByEmail = vi.fn(async () => null);
  create = vi.fn(async () => backofficeOperator);
  createCredentialUser = vi.fn(async () => ({ id: backofficeOperator.id }));
  createPasskeyUser = vi.fn(async () => ({ id: backofficeOperator.id }));
  hasPassword = vi.fn(async () => false);
  updateProfile = vi.fn(async () => backofficeOperator);
  getAccountInfo = vi.fn(async () => ({ createdAt: backofficeOperator.createdAt }));
  getSsoStatus = vi.fn(async () => ({ pendingSsoSetup: false }));
  getTraceExplorerTourPreference = vi.fn(async () => ({ dismissed: false, dismissedAt: null }));
  dismissTraceExplorerTour = vi.fn(async () => ({ dismissed: true, dismissedAt: new Date() }));
  updateLastLogin = vi.fn(async () => undefined);
  tryGetLastHomePath = vi.fn(async () => null);
  setLastHomePath = vi.fn(async () => undefined);
  deactivate = vi.fn(async () => backofficeOperator);
  reactivate = vi.fn(async () => backofficeOperator);
  setAvatar = vi.fn(async () => ({ image: "" }));
  removeAvatar = vi.fn(async () => undefined);
  setFirstPassword = vi.fn(notReached);
  getPasskeyNudgeStatus = vi.fn(notReached);
  dismissPasskeyNudge = vi.fn(notReached);
}

export class AuthStub extends AuthService {
  tryResolveBrowserSession = vi.fn(async () => null);
  revokeAllBrowserSessions = vi.fn(async () => undefined);
  revokeBrowserSession = vi.fn(async () => undefined);
  revokeOtherBrowserSessions = vi.fn(async () => undefined);
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
