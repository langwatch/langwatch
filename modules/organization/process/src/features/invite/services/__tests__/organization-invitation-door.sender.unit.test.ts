/**
 * @vitest-environment node
 * The administrator who asks for a batch is the sender recorded on every invitation in it.
 */
import type { OrganizationCaller } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { OrganizationSignals } from "../../../../services/organization-signals.service.ts";
import { OrganizationInvitationDoorService } from "../organization-invitation-door.service.ts";
import type { OrganizationInvitations } from "../organization-invitations.service.ts";

const CALLER: OrganizationCaller = { id: "user-ana", name: "Ana", email: "ana@acme.test" };

describe("given an administrator creating a batch", () => {
  describe("when the door hands it to the invitations", () => {
    it("names the caller as the sender", async () => {
      const create = vi.fn(async () => ({
        organization: { id: "org-1", members: [] },
        invites: [],
      }));
      const service = OrganizationInvitationDoorService.create({
        billing: {
          createSeatCheckout: async () => {
            throw new Error("this suite opens no seat checkout");
          },
        },
        getOldestTeamId: async () => {
          throw new Error("this suite opens no seat checkout");
        },
        invitations: createApiFixture<OrganizationInvitations>({ create }),
        directory: { findProvenAddresses: async () => [] },
        signals: createApiFixture<OrganizationSignals>({ trackServerEvent: vi.fn() }),
        lifecycle: { membersInvited: vi.fn(), inviteAccepted: vi.fn() },
        creationThrottle: { assertCreationAllowed: async () => {} },
        ceiling: { assertWithinCaller: vi.fn(async () => {}) },
        ensurePersonalWorkspace: vi.fn(async () => undefined),
      });

      await service.create(
        {
          organizationId: "org-1",
          validation: "lenient",
          invites: [{ email: "sam@acme.test", role: "DEVELOPER", teams: [] }],
        },
        CALLER,
      );

      expect(create).toHaveBeenCalledWith(expect.objectContaining({ requestedBy: "user-ana" }));
    });
  });
});
