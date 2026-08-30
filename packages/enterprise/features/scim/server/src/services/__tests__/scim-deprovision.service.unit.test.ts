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
