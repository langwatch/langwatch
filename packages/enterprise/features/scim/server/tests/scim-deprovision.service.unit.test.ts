// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { AuthzGrantsService, OffboardIncompleteError } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";
import { ScimSyncLifecyclePort } from "../src/ports/scim-sync-lifecycle.port";
import { ScimDeprovisionService } from "../src/services/scim-deprovision.service";

class GrantsFake extends AuthzGrantsService {
  readonly attach = vi.fn();
  readonly update = vi.fn();
  readonly revoke = vi.fn();
  readonly replace = vi.fn();
  readonly offboard = vi.fn(async () => ({
    removed: {
      bindings: 0,
      groupMemberships: 0,
      legacyTeamMemberships: 0,
      pendingInvites: 0,
      organizationMembership: true,
    },
    needsHumanDecision: { ownedApiKeys: [], personalTeams: [] },
  }));
  readonly attachBindings = vi.fn();
  readonly attachResourceGrant = vi.fn();
  readonly revokeResourceGrants = vi.fn();
  readonly changeBindingRole = vi.fn();
  readonly revokeBindings = vi.fn();
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

class LifecycleFake extends ScimSyncLifecyclePort {
  readonly tokenIssued = vi.fn(async () => undefined);
  readonly userPushed = vi.fn(async () => undefined);
  readonly groupMapped = vi.fn(async () => undefined);
  readonly applyFailed = vi.fn(async () => undefined);
  readonly revoked = vi.fn(async () => undefined);
}

const ORGANIZATION_ID = "organization_acme";
const CONNECTION_ID = "connection_okta";
const USER_ID = "user_sam";

describe("ScimDeprovisionService", () => {
  it("uses authz's transactional proof for directory removals", async () => {
    const grants = new GrantsFake();
    const lifecycle = new LifecycleFake();
    const service = ScimDeprovisionService.create({ grants, lifecycle });

    await service.removeAccess({
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
      connectionId: CONNECTION_ID,
      op: "delete_user",
    });

    expect(grants.offboard).toHaveBeenCalledWith({
      actor: { type: "system", name: "scim" },
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
    });
  });

  it("records a stable retryable failure when the proof refuses to commit", async () => {
    const grants = new GrantsFake();
    const lifecycle = new LifecycleFake();
    grants.offboard.mockRejectedValueOnce(new OffboardIncompleteError({ remainingBindings: 1 }));
    const service = ScimDeprovisionService.create({ grants, lifecycle });

    await expect(
      service.removeAccess({
        userId: USER_ID,
        organizationId: ORGANIZATION_ID,
        connectionId: CONNECTION_ID,
        op: "deactivate_user",
      }),
    ).rejects.toMatchObject({ code: "offboard_incomplete" });
    expect(lifecycle.applyFailed).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      connectionId: CONNECTION_ID,
      op: "deactivate_user",
      errorCode: "offboard_incomplete",
      retryable: true,
      userId: USER_ID,
    });
  });

  it("does not invent a connection for legacy tokens", async () => {
    const grants = new GrantsFake();
    const lifecycle = new LifecycleFake();
    grants.offboard.mockRejectedValueOnce(new Error("database unavailable"));
    const service = ScimDeprovisionService.create({ grants, lifecycle });

    await service
      .removeAccess({
        userId: USER_ID,
        organizationId: ORGANIZATION_ID,
        connectionId: null,
        op: "delete_user",
      })
      .catch(() => undefined);

    expect(lifecycle.applyFailed).not.toHaveBeenCalled();
  });
});
