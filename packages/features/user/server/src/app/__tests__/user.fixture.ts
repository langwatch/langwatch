import type { AuthApi } from "@langwatch/auth-contract";
import type { OpsApi } from "@langwatch/ops-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { vi } from "vitest";

import { UserAvatarStoragePort, UserPasswordHasherPort } from "../../ports/user.port.ts";

/** The issuer a test deployment stores its credential account rows under. */
export const TEST_CREDENTIAL_ISSUER = "credential";

export function createUserTestAuth() {
  return Object.assign(createApiFixture<AuthApi>(), {
    revokeOtherBrowserSessions: vi.fn(async () => undefined),
    revokeAllBrowserSessions: vi.fn(async () => undefined),
  });
}

export function createUserTestOps() {
  return createApiFixture<OpsApi>({ isAdmin: () => false });
}

export function createUserTestOrganizations(projectId = "project-1") {
  return Object.assign(createApiFixture<OrganizationApi>(), {
    ensurePersonalWorkspace: vi.fn(async () => ({
      project: { id: projectId },
      team: { id: "team-1" },
    })),
    tryFindPersonalWorkspace: vi.fn(async () => null),
  });
}

/** The avatar bytes, kept in the test rather than in an object store. */
export class TestUserAvatarStorage extends UserAvatarStoragePort {
  readonly stored: Array<{ projectId: string; userId: string }> = [];

  async store(input: {
    projectId: string;
    userId: string;
    mediaType: string;
    bytes: Uint8Array;
  }): Promise<{ id: string }> {
    this.stored.push({ projectId: input.projectId, userId: input.userId });

    return { id: `object-${this.stored.length}` };
  }
}

/** A reversible stand-in for bcrypt, so a hash is recognisable in assertions. */
export class TestPasswordHasher extends UserPasswordHasherPort {
  async hash({ password }: { password: string }): Promise<string> {
    return `hashed:${password}`;
  }

  async matches({ password, hash }: { password: string; hash: string }): Promise<boolean> {
    return hash === `hashed:${password}`;
  }
}
