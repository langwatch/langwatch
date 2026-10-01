import type { AdminOperationInput } from "@langwatch/ops-contract";
import type { UserApi, UserProfile } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { TestUserApi } from "../../services/__tests__/support/test-user-api.ts";
import { AdminBackofficeService } from "../../services/admin-backoffice.service.ts";
import { AdminAuditSink } from "../../services/impersonation.service.ts";
import { AdminBackofficeRepository } from "../admin-backoffice.repository.ts";

const user: UserProfile = {
  id: "user-1",
  name: "Alice",
  email: "alice@example.com",
  emailVerified: true,
  image: null,
  pendingSsoSetup: false,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  lastLoginAt: null,
  deactivatedAt: null,
};

/** The one operation an operator's email edit reaches; user ends the sessions on a real change. */
const updateProfileFake = (email = user.email) =>
  vi.fn(async (): Promise<UserProfile> => ({ ...user, email }));

class RepositoryFake extends AdminBackofficeRepository {
  execute = vi.fn();
  findUserById = vi.fn(async () => ({ data: user }));
}

class AuditFake extends AdminAuditSink {
  record = vi.fn(async () => undefined);
}

function input(email: string): AdminOperationInput {
  return {
    resource: "user",
    method: "update",
    params: { id: user.id, data: { email } },
    actorId: "operator-1",
    req: { headers: {} },
  };
}

function serviceWith(updateProfile: UserApi["updateProfile"]) {
  return AdminBackofficeService.create({
    repository: new RepositoryFake(),
    users: new TestUserApi({ updateProfile }),
    audit: new AuditFake(),
  });
}

describe("AdminBackofficeService user email updates", () => {
  /** @scenario "An operator changing a user's email revokes their browser sessions" */
  it("hands the normalised email to user, which revokes on a real change", async () => {
    const updateProfile = updateProfileFake("new@example.com");

    await serviceWith(updateProfile).execute(input(" NEW@example.com "));

    expect(updateProfile).toHaveBeenCalledWith({ id: user.id, email: "new@example.com" });
  });

  /** @scenario "A change that only differs in case or spacing revokes nothing" */
  it("hands a case-only change to user as the stored email", async () => {
    const updateProfile = updateProfileFake();

    await serviceWith(updateProfile).execute(input(" ALICE@EXAMPLE.COM "));

    expect(updateProfile).toHaveBeenCalledWith({ id: user.id, email: user.email });
  });

  /** @scenario "A failed revocation still leaves the new backoffice email in place" */
  it("surfaces a revocation failure from user, which saved the email first", async () => {
    const updateProfile = vi.fn(async (): Promise<UserProfile> => {
      throw new Error("redis unavailable");
    });

    await expect(serviceWith(updateProfile).execute(input("new@example.com"))).rejects.toThrow(
      "redis unavailable",
    );
    expect(updateProfile).toHaveBeenCalledWith({ id: user.id, email: "new@example.com" });
  });
});
