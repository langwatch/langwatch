/**
 * @vitest-environment node
 *
 * A revoke and an acceptance meeting on one invitation, against a real
 * Postgres.
 *
 * Both writes are conditional on the row still being PENDING, and both are
 * legitimate: the admin revoking has the right to, and the invitee's address
 * was verified at acceptance. What decides is the row lock. The revoke is
 * held open in its own transaction until the acceptance is parked on the
 * lock, and only then commits; the acceptance then has to re-read the row as
 * the revoke left it, or the admin's revocation is silently lost.
 *
 * @see ../invite.service.ts
 * @see specs/organizations/organization-members-rest-api.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OrganizationUserRole } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { raceOnOneRow } from "~/test-utils/rowLockInterleaving";
import { InviteService } from "../invite.service";

const ns = `inv-accept-${nanoid(8)}`;
const INVITEE_EMAIL = `invitee-${ns}@acme.test`;

let organizationId: string;
let inviteeUserId: string;

// No app is wired: neither the revoke nor a refused acceptance reads the
// plan or emits a grant, so the service runs on the database alone.
beforeAll(async () => {
  const organization = await prisma.organization.create({
    data: { name: "ACME", slug: `--${ns}` },
  });
  organizationId = organization.id;
  const invitee = await prisma.user.create({
    data: { email: INVITEE_EMAIL, name: "Invitee" },
  });
  inviteeUserId = invitee.id;
});

afterAll(async () => {
  await cleanupTestRows(prisma, [
    ["organizationInvite", { organizationId }],
    ["organizationUser", { organizationId }],
    ["organization", { id: organizationId }],
    ["user", { id: inviteeUserId }],
  ]);
});

describe("accepting an invitation on Postgres", () => {
  describe("given a pending invitation an admin revokes as the invitee accepts it", () => {
    /** @scenario "A revocation landing during an acceptance stands" */
    it("refuses the acceptance and writes no membership, because the claim re-reads the row it waited for", async () => {
      const invite = await prisma.organizationInvite.create({
        data: {
          email: INVITEE_EMAIL,
          inviteCode: `code-${ns}`,
          organizationId,
          teamIds: "",
          role: OrganizationUserRole.MEMBER,
          expiration: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      const answers = await raceOnOneRow<string>({
        prisma,
        table: "OrganizationInvite",
        first: async (tx) => {
          await InviteService.create(tx).revokeInvite({
            organizationId,
            inviteId: invite.id,
          });
          return "revoked";
        },
        // On the root client: the acceptance opens the transaction that
        // holds its claim and its membership write together.
        second: () =>
          InviteService.create(prisma)
            .applyInvite({ userId: inviteeUserId, invite })
            .then(
              () => "accepted",
              (error: { code?: string; message: string }) =>
                `${error.code}: ${error.message}`,
            ),
      });

      expect(answers.second).toBe(
        "invite_not_found: Invitation is no longer open",
      );
      const row = await prisma.organizationInvite.findFirstOrThrow({
        where: { id: invite.id, organizationId },
      });
      expect(row.status).toBe("REVOKED");
      expect(row.acceptedByUserId).toBeNull();
      expect(
        await prisma.organizationUser.findFirst({
          where: { organizationId, userId: inviteeUserId },
        }),
      ).toBeNull();
    });
  });
});
