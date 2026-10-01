/**
 * @vitest-environment node
 * `signInSecurity.*`: each procedure calls its one operation, and a release is
 * recorded against the administrator the session carried.
 * @see specs/identity/org-account-lockout.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { createTrpcRuntime } from "@langwatch/api/trpc";
import type { AuthApi } from "@langwatch/auth-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { signInSecurityTrpcTransport } from "../sign-in-security.trpc.ts";
import { authTrpcTestMembers, type AuthTrpcTestContext } from "./auth.trpc.harness.ts";

const SETTINGS = {
  lockoutAfterFailedAttempts: 5,
  lockoutMinutes: 30,
  sessionIdleTimeoutMinutes: 60,
  sessionMaxLifetimeMinutes: 0,
};

function mounted(api: AuthApi, permitted = true) {
  const trpc = initTRPC.context<AuthTrpcTestContext>().create();
  const members = authTrpcTestMembers();
  const router = createTrpcRuntime<AuthTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    anonymousProcedure: trpc.procedure,
    members: {
      ...members,
      authorization: {
        forRequest: () => ({
          getDecision: async () => ({ permitted, organizationRole: null }),
          getProjectAnyDecision: async () => ({ permitted, organizationRole: null }),
          checkScopeLineage: async () => ({ kind: "consistent" }),
        }),
      },
    },
  }).mount(signInSecurityTrpcTransport, () => api);

  return router.createCaller({ actor: { id: "ana" } });
}

describe("the sign-in security door", () => {
  it("reads the organization's rules through the one operation", async () => {
    const getSignInSecuritySettings = vi.fn(async () => SETTINGS);
    const caller = mounted(createApiFixture<AuthApi>({ getSignInSecuritySettings }));

    await expect(caller.get({ organizationId: "acme" })).resolves.toEqual(SETTINGS);
    expect(getSignInSecuritySettings).toHaveBeenCalledWith({ organizationId: "acme" });
  });

  it("refuses a caller the permission decision denies, and asks nothing", async () => {
    const getSignInSecuritySettings = vi.fn(async () => SETTINGS);
    const caller = mounted(createApiFixture<AuthApi>({ getSignInSecuritySettings }), false);

    await expect(caller.get({ organizationId: "acme" })).rejects.toMatchObject({
      cause: { code: "permission_denied" },
    });
    expect(getSignInSecuritySettings).not.toHaveBeenCalled();
  });

  it("saves and answers how many sessions the new window ended", async () => {
    const saveSignInSecuritySettings = vi.fn(async () => ({ ok: true as const, sweptSessions: 3 }));
    const caller = mounted(createApiFixture<AuthApi>({ saveSignInSecuritySettings }));

    await expect(caller.save({ organizationId: "acme", ...SETTINGS })).resolves.toEqual({
      ok: true,
      sweptSessions: 3,
    });
    expect(saveSignInSecuritySettings).toHaveBeenCalledWith({
      organizationId: "acme",
      ...SETTINGS,
    });
  });

  /** @scenario "An administrator can release a held account" */
  it("releases with the session's administrator as the actor", async () => {
    const releaseHeldAccount = vi.fn(async () => ({ released: true }));
    const caller = mounted(createApiFixture<AuthApi>({ releaseHeldAccount }));

    await expect(caller.release({ organizationId: "acme", userId: "sam" })).resolves.toEqual({
      released: true,
    });
    expect(releaseHeldAccount).toHaveBeenCalledWith({
      organizationId: "acme",
      userId: "sam",
      actorUserId: "ana",
    });
  });
});
