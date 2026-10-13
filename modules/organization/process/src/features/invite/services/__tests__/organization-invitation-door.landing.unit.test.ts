/**
 * @vitest-environment node
 * @see modules/organization/specs/invitations.feature
 * The signed-out invite landing reads the invitation behind a code (WEB-860).
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import type { OrganizationInviteRepository } from "../../../../repositories/organization-invite.repository.ts";
import type { OrganizationUserDirectoryRepository } from "../../../../repositories/organization-user-directory.repository.ts";
import type { OrganizationSignals } from "../../../../services/organization-signals.service.ts";
import type { InviteSendThrottleService } from "../invite-send-throttle.service.ts";
import type { InviteService } from "../invite.service.ts";
import { OrganizationInvitationDoorService } from "../organization-invitation-door.service.ts";
import {
  OrganizationInvitationsService,
  type OrganizationInvitations,
} from "../organization-invitations.service.ts";

type Landing = Awaited<ReturnType<OrganizationInvitations["findLandingByCode"]>>;

function door(invitations: OrganizationInvitations) {
  return OrganizationInvitationDoorService.create({
    billing: {
      createSeatCheckout: async () => {
        throw new Error("this suite opens no seat checkout");
      },
    },
    getOldestTeamId: async () => {
      throw new Error("this suite opens no seat checkout");
    },
    invitations,
    directory: { findProvenAddresses: vi.fn(async () => []) },
    signals: createApiFixture<OrganizationSignals>({ trackServerEvent: vi.fn() }),
    lifecycle: { membersInvited: vi.fn(), inviteAccepted: vi.fn() },
    creationThrottle: { assertCreationAllowed: async () => {} },
    ceiling: { assertWithinCaller: vi.fn(async () => {}) },
    ensurePersonalWorkspace: vi.fn(async () => undefined),
  });
}

const inMs = (ms: number) => Temporal.Now.instant().add({ milliseconds: ms });

function invite(overrides: Partial<NonNullable<Landing>>): NonNullable<Landing> {
  return {
    id: "invite-1",
    email: "sam@acme.com",
    inviteCode: "code-1",
    expiration: inMs(60_000),
    status: "PENDING",
    organizationId: "org-1",
    teamIds: "",
    teamAssignments: null,
    role: "MEMBER",
    requestedBy: "user-ana",
    subscriptionId: null,
    acceptedByUserId: null,
    acceptedViaIdentifierId: null,
    createdAt: inMs(-60_000),
    updatedAt: inMs(-60_000),
    organization: { id: "org-1", name: "Acme" },
    inviterName: "Ana",
    ...overrides,
  };
}

function landingDoor(found: Landing) {
  const displayStatus = (facts: Parameters<OrganizationInvitations["displayStatus"]>[0]) =>
    facts.status === "PENDING" &&
    facts.expiration &&
    facts.expiration.epochMilliseconds <= Date.now()
      ? "EXPIRED"
      : facts.status;
  const requestFresh = vi.fn(async () => {});
  const service = door(
    createApiFixture<OrganizationInvitations>({
      findLandingByCode: vi.fn(async () => found),
      displayStatus,
      requestFresh,
    }),
  );
  return { service, requestFresh };
}

describe("given an invitation link opened by whoever holds it", () => {
  /** @scenario A pending invitation's link names the organization and who asked */
  it("names the organization and the inviter for a pending invitation", async () => {
    const { service } = landingDoor(invite({}));

    await expect(service.landing({ inviteCode: "code-1" })).resolves.toEqual({
      organizationName: "Acme",
      inviterName: "Ana",
      alreadyAccepted: false,
    });
  });

  /** @scenario A revoked or unknown invitation link reads as not found */
  it.each([
    ["revoked", invite({ status: "REVOKED" })],
    ["unknown", null],
  ])("refuses a %s invitation as not found", async (_label, found) => {
    const { service } = landingDoor(found);

    await expect(service.landing({ inviteCode: "code-1" })).rejects.toMatchObject({
      code: "invite_not_found",
    });
  });

  /** @scenario An expired invitation link is refused as expired and can ask for a fresh one */
  it("refuses an expired invitation as expired", async () => {
    const { service } = landingDoor(invite({ expiration: inMs(-60_000) }));

    await expect(service.landing({ inviteCode: "code-1" })).rejects.toMatchObject({
      code: "invite_expired",
    });
  });

  /** @scenario An expired invitation link is refused as expired and can ask for a fresh one */
  it("asks for a fresh invitation with the members settings link", async () => {
    const requestFreshInvite = vi.fn(async () => ({ notifiedAdmins: 1 }));
    const invitations = OrganizationInvitationsService.create({
      invites: createApiFixture<InviteService>({ requestFreshInvite }),
      repository: createApiFixture<OrganizationInviteRepository>(),
      throttle: createApiFixture<InviteSendThrottleService>(),
      baseHost: "https://lw.example",
      identity: { verifiedEmailsOf: vi.fn() },
      userDirectory: createApiFixture<OrganizationUserDirectoryRepository>(),
      notices: { record: vi.fn() },
    });

    await door(invitations).requestFresh({ inviteCode: "code-1" });

    expect(requestFreshInvite).toHaveBeenCalledWith({
      inviteCode: "code-1",
      membersSettingsUrl: "https://lw.example/settings/members",
    });
  });
});
