// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AuthzAccessBinding } from "@langwatch/authz-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GrantsFake, listedGrant } from "../../__tests__/support/grants-fake.ts";
import { type DesiredScimGrant, ScimGrantsService } from "../scim-grants.service.ts";

const organizationId = "org_1";
const userId = "user_1";

const memberGrant: DesiredScimGrant = {
  principal: { userId },
  role: "MEMBER",
  customRoleId: null,
  scopeType: "ORGANIZATION",
  scopeId: organizationId,
};

const roleBindingKsuid = /^(?:[a-z\d]+_)?rolebinding_[a-zA-Z\d]{29}$/;

const storedMember: AuthzAccessBinding = listedGrant({
  id: "binding_1",
  organizationId,
  userId,
  groupId: null,
  apiKeyId: null,
  scopeType: "ORGANIZATION",
  scopeId: organizationId,
  role: "MEMBER",
  customRoleId: null,
});

describe("SCIM grant reconciliation", () => {
  let grants: GrantsFake;

  beforeEach(() => {
    grants = new GrantsFake();
  });

  const reconcile = (desired: DesiredScimGrant[]) =>
    ScimGrantsService.create({ grants }).reconcile({
      scope: {
        kind: "organization-membership",
        organizationId,
        userId,
      },
      desired,
      actor: { type: "system", id: "system:scim" },
    });

  it("attaches only a missing grant as a SCIM fact", async () => {
    expect(await reconcile([memberGrant])).toEqual({ attached: 1, revoked: 0 });
    expect(grants.attachBindings).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        source: "scim",
        onDuplicate: "skip",
        bindings: [expect.objectContaining({ bindingId: expect.any(String) })],
      }),
    );
    expect(grants.revokeBindings).not.toHaveBeenCalled();
  });

  it("stays silent when nothing is stored and nothing is asserted", async () => {
    // An empty push is not a command with no bindings in it: a sync that
    // asserts nothing about a person writes nothing about them at all.
    expect(await reconcile([])).toEqual({ attached: 0, revoked: 0 });
    expect(grants.attachBindings).not.toHaveBeenCalled();
    expect(grants.revokeBindings).not.toHaveBeenCalled();
  });

  it("emits nothing when the projection already matches", async () => {
    grants.listUserBindings.mockResolvedValue([storedMember]);

    expect(await reconcile([memberGrant])).toEqual({ attached: 0, revoked: 0 });
    expect(grants.attachBindings).not.toHaveBeenCalled();
    expect(grants.revokeBindings).not.toHaveBeenCalled();
  });

  it("revokes a grant the directory stopped asserting", async () => {
    grants.listUserBindings.mockResolvedValue([storedMember]);

    expect(await reconcile([])).toEqual({ attached: 0, revoked: 1 });
    expect(grants.revokeBindings).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId, bindingIds: ["binding_1"] }),
    );
  });

  it("revokes by the grant id the listing returned", async () => {
    grants.listUserBindings.mockResolvedValue([{ ...storedMember, id: "grant_from_listing" }]);

    await reconcile([]);

    expect(grants.revokeBindings).toHaveBeenCalledWith(
      expect.objectContaining({ bindingIds: ["grant_from_listing"] }),
    );
  });

  it("revokes the stale role before attaching its replacement", async () => {
    grants.listUserBindings.mockResolvedValue([{ ...storedMember, role: "VIEWER" }]);

    expect(await reconcile([memberGrant])).toEqual({ attached: 1, revoked: 1 });
    expect(grants.revokeBindings).toHaveBeenCalledBefore(grants.attachBindings);
  });

  it("distinguishes a custom role at the same scope", async () => {
    grants.listUserBindings.mockResolvedValue([
      { ...storedMember, id: "binding_custom", customRoleId: "custom_1" },
    ]);

    expect(await reconcile([memberGrant])).toEqual({ attached: 1, revoked: 1 });
    expect(grants.revokeBindings).toHaveBeenCalledWith(
      expect.objectContaining({ bindingIds: ["binding_custom"] }),
    );
  });

  it("uses the same tenant scope for the projection and every command", async () => {
    grants.listUserBindings.mockResolvedValue([storedMember]);

    await reconcile([]);

    expect(grants.listUserBindings).toHaveBeenCalledWith({ organizationId, userId });
    expect(grants.revokeBindings).toHaveBeenCalledWith(expect.objectContaining({ organizationId }));
  });
  describe("when two grants are minted in the same millisecond", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-01T00:00:00.000Z") });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** @scenario "Two grants minted in the same millisecond get distinct role-binding ids" */
    it("gives each its own rolebinding KSUID", async () => {
      await reconcile([memberGrant]);
      await reconcile([memberGrant]);

      const ids = grants.attachBindings.mock.calls.map(([call]) => call.bindings[0]?.bindingId);
      expect(ids).toHaveLength(2);
      expect(ids[0]).toMatch(roleBindingKsuid);
      expect(ids[1]).toMatch(roleBindingKsuid);
      expect(ids[0]).not.toBe(ids[1]);
    });
  });
});
