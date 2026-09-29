/**
 * @vitest-environment node
 *
 * A minted session tells nurturing through auth's own event, ids only, and never fails the sign-in.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { BetterAuthHooksRepository } from "../../../repositories/better-auth-hooks.repository.ts";
import type { BetterAuthAnnouncements } from "../../better-auth.channel.ts";
import { afterSessionCreate } from "../http.better-auth-hooks.channel.ts";

function signIn({ memberships }: { memberships: () => Promise<number> }) {
  const sessionNurturing = vi.fn();
  const repo = createApiFixture<BetterAuthHooksRepository>({
    recordLastLogin: async () => undefined,
    countOrgMembershipsForUser: memberships,
  });
  const announcements = createApiFixture<BetterAuthAnnouncements>({ sessionNurturing });
  return {
    sessionNurturing,
    run: () => afterSessionCreate({ repo, userId: "user_ada", announcements }),
  };
}

describe("afterSessionCreate's nurturing notice", () => {
  it("tells nurturing the person's id only when they belong to an organization", async () => {
    const { sessionNurturing, run } = signIn({ memberships: async () => 1 });

    await run();

    await vi.waitFor(() => expect(sessionNurturing).toHaveBeenCalledWith({ userId: "user_ada" }));
  });

  it("tells nurturing nothing for a person still onboarding", async () => {
    const { sessionNurturing, run } = signIn({ memberships: async () => 0 });

    await run();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sessionNurturing).not.toHaveBeenCalled();
  });

  /** @scenario "Activity tracking failure does not break the login flow" */
  it("completes the sign-in when the membership read fails", async () => {
    const { sessionNurturing, run } = signIn({
      memberships: async () => {
        throw new Error("database unavailable");
      },
    });

    await expect(run()).resolves.toBeUndefined();
    expect(sessionNurturing).not.toHaveBeenCalled();
  });
});
