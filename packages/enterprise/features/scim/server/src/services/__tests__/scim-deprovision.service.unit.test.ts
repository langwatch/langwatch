// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { OffboardIncompleteError } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";
import { ScimSyncLifecyclePort } from "../../ports/scim-sync-lifecycle.port";
import { ScimDeprovisionService } from "../scim-deprovision.service";
import { GrantsFake } from "../../__tests__/support/grants-fake";

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
  /** @scenario "The proof runs on every path a directory can remove somebody by" */
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

  /** @scenario "A removal that cannot prove itself empty fails loudly" */
  /** @scenario "A deprovision that cannot prove itself empty fails loudly" */
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

  /** @scenario "A removal decision needing a person is surfaced, not guessed at" */
  it("removes their access anyway and answers what needs a decision", async () => {
    const grants = new GrantsFake();
    const lifecycle = new LifecycleFake();
    grants.offboard.mockResolvedValueOnce({
      removed: {
        bindings: 0,
        groupMemberships: 0,
        legacyTeamMemberships: 0,
        pendingInvites: 0,
        organizationMembership: true,
      },
      needsHumanDecision: {
        ownedApiKeys: [{ id: "key_1", name: "CI key" }],
        personalTeams: [{ id: "team_1", name: "Sam's team" }],
      },
    });
    const service = ScimDeprovisionService.create({ grants, lifecycle });

    const manifest = await service.removeAccess({
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
      connectionId: CONNECTION_ID,
      op: "delete_user",
    });

    expect(grants.offboard).toHaveBeenCalled();
    expect(manifest).toEqual({
      ownedApiKeys: [{ id: "key_1", name: "CI key" }],
      personalTeams: [{ id: "team_1", name: "Sam's team" }],
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
