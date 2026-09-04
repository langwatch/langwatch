/**
 * ADR-027 site #4: the ssoDomain auto-join `afterUserCreate` runs is
 * federation, and it rides the same platform SSO license gate as every other
 * provider — a domain-matched organization must not gain a member off a
 * licensing store answer of "no genuine license".
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";

import type {
  BetterAuthAnnouncementsPort,
  BetterAuthFederationPort,
  BetterAuthPendingInvitePort,
} from "../../../ports/better-auth.port";
import { afterUserCreate } from "../better-auth-hooks";

class StubFederationPort implements BetterAuthFederationPort {
  constructor(private readonly ssoAllowed: boolean) {}
  federationCapable(): boolean {
    return true;
  }
  resolveSignInMethodPolicy(): Promise<never> {
    return Promise.reject(new Error("unused"));
  }
  platformSsoAllowed(): Promise<boolean> {
    return Promise.resolve(this.ssoAllowed);
  }
}

class StubInvitesPort implements BetterAuthPendingInvitePort {
  findPendingByOrganizationAndEmail(): Promise<null> {
    return Promise.resolve(null);
  }
  applyInvite(): Promise<void> {
    return Promise.reject(new Error("unused"));
  }
}

class StubAnnouncementsPort implements BetterAuthAnnouncementsPort {
  readonly trackServerEvent = vi.fn();
  readonly reportError = vi.fn();
  announceSignup(): never {
    throw new Error("unused");
  }
  ssoAutoAddNurturing(): never {
    throw new Error("unused");
  }
  sessionNurturing(): never {
    throw new Error("unused");
  }
}

function organizationPrisma(organization: { id: string; ssoDomain: string } | null): PrismaClient {
  return {
    organization: { findUnique: vi.fn().mockResolvedValue(organization) },
    organizationUser: { create: vi.fn() },
  } as unknown as PrismaClient;
}

describe("the ssoDomain auto-join on an unlicensed deployment", () => {
  /** @scenario "Unlicensed-mode signup does not auto-join a domain-matched organization" */
  it("creates the account and skips the domain-matched organization entirely", async () => {
    const federation = new StubFederationPort(false);
    const prisma = organizationPrisma({ id: "org_1", ssoDomain: "acme.com" });

    await afterUserCreate({
      prisma,
      user: { id: "user_1", email: "new@acme.com", name: "New User" },
      collaborators: {
        federation,
        invites: new StubInvitesPort(),
        announcements: new StubAnnouncementsPort(),
        authzGrants: {} as never,
      },
    });

    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    expect(prisma.organizationUser.create).not.toHaveBeenCalled();
  });
});
