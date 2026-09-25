// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { beforeEach, describe, expect, it, vi } from "vitest";

import { GrantsFake } from "../../__tests__/support/grants-fake.ts";
import {
  ScimGrantRepository,
  type ScimGrantBindingScope,
  type ScimRoleBindingRecord,
} from "../../repositories/scim.repository.ts";
import { type DesiredScimGrant, ScimGrantsService } from "../scim-grants.service.ts";

const organizationId = "org_1";
const userId = "user_1";

class GrantRepositoryFake extends ScimGrantRepository {
  readonly findRoleBindings = vi.fn<
    (scope: ScimGrantBindingScope) => Promise<ScimRoleBindingRecord[]>
  >(async () => []);
}

const memberGrant: DesiredScimGrant = {
  principal: { userId },
  role: "MEMBER",
  customRoleId: null,
  scopeType: "ORGANIZATION",
  scopeId: organizationId,
};

const storedMember: ScimRoleBindingRecord = {
  id: "binding_1",
  userId,
  groupId: null,
  apiKeyId: null,
  scopeType: "ORGANIZATION",
  scopeId: organizationId,
  role: "MEMBER",
  customRoleId: null,
};

describe("SCIM grant reconciliation", () => {
  let repository: GrantRepositoryFake;
  let grants: GrantsFake;

  beforeEach(() => {
    repository = new GrantRepositoryFake();
    grants = new GrantsFake();
  });

  const reconcile = (desired: DesiredScimGrant[]) =>
    ScimGrantsService.create({ repository, grants }).reconcile({
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
    repository.findRoleBindings.mockResolvedValue([storedMember]);

    expect(await reconcile([memberGrant])).toEqual({ attached: 0, revoked: 0 });
    expect(grants.attachBindings).not.toHaveBeenCalled();
    expect(grants.revokeBindings).not.toHaveBeenCalled();
  });

  it("revokes a grant the directory stopped asserting", async () => {
    repository.findRoleBindings.mockResolvedValue([storedMember]);

    expect(await reconcile([])).toEqual({ attached: 0, revoked: 1 });
    expect(grants.revokeBindings).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId, bindingIds: ["binding_1"] }),
    );
  });

  it("revokes the stale role before attaching its replacement", async () => {
    repository.findRoleBindings.mockResolvedValue([{ ...storedMember, role: "VIEWER" }]);

    expect(await reconcile([memberGrant])).toEqual({ attached: 1, revoked: 1 });
    expect(grants.revokeBindings).toHaveBeenCalledBefore(grants.attachBindings);
  });

  it("distinguishes a custom role at the same scope", async () => {
    repository.findRoleBindings.mockResolvedValue([
      { ...storedMember, id: "binding_custom", customRoleId: "custom_1" },
    ]);

    expect(await reconcile([memberGrant])).toEqual({ attached: 1, revoked: 1 });
    expect(grants.revokeBindings).toHaveBeenCalledWith(
      expect.objectContaining({ bindingIds: ["binding_custom"] }),
    );
  });

  it("uses the same tenant scope for the projection and every command", async () => {
    repository.findRoleBindings.mockResolvedValue([storedMember]);

    await reconcile([]);

    expect(repository.findRoleBindings).toHaveBeenCalledWith({
      kind: "organization-membership",
      organizationId,
      userId,
    });
    expect(grants.revokeBindings).toHaveBeenCalledWith(expect.objectContaining({ organizationId }));
  });
});
