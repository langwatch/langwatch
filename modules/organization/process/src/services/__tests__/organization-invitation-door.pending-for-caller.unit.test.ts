/**
 * @vitest-environment node
 * @see specs/identity/join-before-create.feature
 * invite.pendingForMe answers with the invitation code, so it asks only about PROVED addresses.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { OrganizationInvitationDoorService } from "../organization-invitation-door.service.ts";
import type { OrganizationInvitations } from "../organization-invitations.service.ts";
import type { OrganizationSignals } from "../organization-signals.service.ts";

function door({ proven }: { proven: string[] }) {
  const findPendingForAddresses = vi.fn(async () => []);
  const findProvenAddresses = vi.fn(async () => proven);
  const service = OrganizationInvitationDoorService.create({
    invitations: createApiFixture<OrganizationInvitations>({ findPendingForAddresses }),
    directory: { findProvenAddresses },
    joinRequests: null,
    signals: createApiFixture<OrganizationSignals>({ trackServerEvent: vi.fn() }),
    lifecycle: { membersInvited: vi.fn(), inviteAccepted: vi.fn() },
    creationThrottle: { assertCreationAllowed: async () => {} },
    ceiling: { assertWithinCaller: vi.fn(async () => {}) },
    ensurePersonalWorkspace: vi.fn(async () => undefined),
  });
  return { service, findPendingForAddresses, findProvenAddresses };
}

describe("given the welcome screen asking for the caller's waiting invitations", () => {
  describe("when the session address has an invitation but is not yet proved", () => {
    /** @scenario An invitation is only offered to somebody who proved the address */
    it("asks about the proven addresses only, which here are none", async () => {
      const { service, findPendingForAddresses, findProvenAddresses } = door({ proven: [] });

      await expect(service.listPendingForCaller({ userId: "user-1" })).resolves.toEqual([]);

      expect(findProvenAddresses).toHaveBeenCalledWith({ userId: "user-1" });
      expect(findPendingForAddresses).toHaveBeenCalledWith({ addresses: [] });
    });

    /** @scenario An invitation is only offered to somebody who proved the address */
    it("asks only about the proved addresses, never the session's", async () => {
      const { service, findPendingForAddresses } = door({ proven: ["ana@acme.com"] });

      await service.listPendingForCaller({ userId: "user-1" });

      expect(findPendingForAddresses).toHaveBeenCalledWith({ addresses: ["ana@acme.com"] });
    });
  });
});
