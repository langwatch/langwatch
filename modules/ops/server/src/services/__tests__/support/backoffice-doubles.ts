/**
 * The collaborators the backoffice's organization edit does NOT reach: a
 * legacy single sign-on refusal happens before storage, so the repository
 * records whether it was called at all and the rest throw.
 */
import { AuthService } from "@langwatch/auth-contract";
import type { AdminOperationInput, AdminOperationResult } from "@langwatch/ops-contract";
import type { UserProfile } from "@langwatch/user-contract";
import { vi } from "vitest";
import { AdminBackofficeRepository } from "../../../repositories/admin-backoffice.repository.ts";
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
