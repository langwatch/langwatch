// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { AuthzGrantsService } from "@langwatch/authz-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ScimGrantRepositoryPort,
  type ScimGrantBindingScope,
  type ScimRoleBindingRecord,
} from "../src/ports/scim-repository.port";
import { type DesiredScimGrant, ScimGrantsService } from "../src/services/scim-grants.service";

const organizationId = "org_1";
const userId = "user_1";

class GrantRepositoryFake extends ScimGrantRepositoryPort {
  readonly listRoleBindings = vi.fn<
    (scope: ScimGrantBindingScope) => Promise<ScimRoleBindingRecord[]>
  >(async () => []);
}

class GrantsFake extends AuthzGrantsService {
  readonly attach = vi.fn();
  readonly update = vi.fn();
  readonly revoke = vi.fn();
  readonly replace = vi.fn();
  readonly offboard = vi.fn();
  readonly attachBindings = vi.fn(async () => []);
  readonly attachResourceGrant = vi.fn();
  readonly revokeResourceGrants = vi.fn();
  readonly changeBindingRole = vi.fn();
  readonly revokeBindings = vi.fn(async () => []);
  readonly revokeBindingsWhere = vi.fn();
  readonly offboardMember = vi.fn();
  readonly defineRole = vi.fn();
  readonly deleteRole = vi.fn();
  readonly createBinding = vi.fn();
  readonly updateBinding = vi.fn();
  readonly deleteBinding = vi.fn();
  readonly applyMemberBindings = vi.fn();
  readonly invalidateOrganization = vi.fn();
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

  it("emits nothing when the projection already matches", async () => {
    repository.listRoleBindings.mockResolvedValue([storedMember]);

    expect(await reconcile([memberGrant])).toEqual({ attached: 0, revoked: 0 });
    expect(grants.attachBindings).not.toHaveBeenCalled();
    expect(grants.revokeBindings).not.toHaveBeenCalled();
  });

  it("revokes a grant the directory stopped asserting", async () => {
    repository.listRoleBindings.mockResolvedValue([storedMember]);

    expect(await reconcile([])).toEqual({ attached: 0, revoked: 1 });
    expect(grants.revokeBindings).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId, bindingIds: ["binding_1"] }),
    );
  });

  it("revokes the stale role before attaching its replacement", async () => {
    repository.listRoleBindings.mockResolvedValue([{ ...storedMember, role: "VIEWER" }]);

    expect(await reconcile([memberGrant])).toEqual({ attached: 1, revoked: 1 });
    expect(grants.revokeBindings).toHaveBeenCalledBefore(grants.attachBindings);
  });

  it("distinguishes a custom role at the same scope", async () => {
    repository.listRoleBindings.mockResolvedValue([
      { ...storedMember, id: "binding_custom", customRoleId: "custom_1" },
    ]);

    expect(await reconcile([memberGrant])).toEqual({ attached: 1, revoked: 1 });
    expect(grants.revokeBindings).toHaveBeenCalledWith(
      expect.objectContaining({ bindingIds: ["binding_custom"] }),
    );
  });

  it("uses the same tenant scope for the projection and every command", async () => {
    repository.listRoleBindings.mockResolvedValue([storedMember]);

    await reconcile([]);

    expect(repository.listRoleBindings).toHaveBeenCalledWith({
      kind: "organization-membership",
      organizationId,
      userId,
    });
    expect(grants.revokeBindings).toHaveBeenCalledWith(expect.objectContaining({ organizationId }));
  });
});
