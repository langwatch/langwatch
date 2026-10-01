import { createApiFixture } from "@langwatch/api-fixture";
import type { UserApi, UserProfile } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { platformOperatorAuthz } from "../../app/__tests__/ops.fixture.ts";
import { AdminAccessService } from "../admin-access.service.ts";

const OPERATOR_ID = "user_operator";

const accessWith = (holders: Parameters<typeof platformOperatorAuthz>[0] = {}) =>
  AdminAccessService.create({
    authz: platformOperatorAuthz(holders),
    users: createApiFixture<UserApi>({
      findByEmail: async ({ email }) =>
        email.trim().toLowerCase() === "root@langwatch.ai"
          ? createApiFixture<UserProfile>({ id: OPERATOR_ID })
          : null,
    }),
  });

describe("AdminAccessService", () => {
  /** @scenario "Admin email matching is normalized" */
  it("resolves an identity naming only an address to its account, then asks authz", async () => {
    const access = accessWith({ holders: { [OPERATOR_ID]: ["ops:view"] } });

    expect(await access.isAdmin({ email: " Root@Langwatch.ai " })).toBe(true);
    expect(await access.isAdmin({ email: "someone@acme.com" })).toBe(false);
    expect(await access.isAdmin({ email: null })).toBe(false);
  });

  it("answers by account id without looking an address up", async () => {
    const access = accessWith({ holders: { [OPERATOR_ID]: ["ops:view"] } });

    expect(await access.isAdmin({ id: OPERATOR_ID })).toBe(true);
    expect(await access.isAdmin({ id: "user_other", email: "root@langwatch.ai" })).toBe(false);
  });

  it("asks for the permission it was given, so a viewer cannot manage", async () => {
    const access = accessWith({ holders: { [OPERATOR_ID]: ["ops:view"] } });

    expect(await access.holds({ identity: { id: OPERATOR_ID }, permission: "ops:view" })).toBe(
      true,
    );
    expect(await access.holds({ identity: { id: OPERATOR_ID }, permission: "ops:manage" })).toBe(
      false,
    );
  });
});
