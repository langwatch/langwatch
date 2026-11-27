/**
 * Every invitation of an organization through `OrganizationModule.create` over the memory
 * registry, as a staff investigation reads it: statuses, ids and times, never an address or code.
 * @see dev/docs/adr/202-ops-agent-access.md
 */
import { type Instant, nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationDatabase } from "../../repositories/memory/memory.organization.database.ts";
import { TestAuthzApi } from "../../transport/__tests__/support/test-authz-api.ts";
import { OrganizationModule } from "../organization.app.ts";
import { organizationModuleSetup } from "./support/organization-module-setup.ts";

const ORGANIZATION_ID = "org-1";
const ADMIN = { id: "user-admin" };

type Seed = Readonly<{
  id: string;
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "PAYMENT_PENDING";
  createdAt: Instant;
  expiration: Instant | null;
  subscriptionId?: string;
  acceptedByUserId?: string;
  organizationId?: string;
}>;

async function application(seeds: readonly Seed[]) {
  const permissions = TestAuthzApi.create({
    people: [{ id: ADMIN.id, name: "Ana", email: "ana@acme.test" }],
  });
  const memory = MemoryOrganizationDatabase.create();
  const setup = organizationModuleSetup({ permissions, memory });
  await setup.repositories.membership(permissions).createAndAssign({
    userId: ADMIN.id,
    orgId: ORGANIZATION_ID,
    orgName: "ACME",
    orgSlug: "acme",
    teamId: "team-1",
    teamSlug: "engineering",
    pricingModel: "SEAT_EVENT",
  });
  for (const seed of seeds) {
    memory.invites.set(seed.id, {
      id: seed.id,
      email: `${seed.id}@acme.test`,
      inviteCode: `code-${seed.id}`,
      expiration: seed.expiration,
      status: seed.status,
      organizationId: seed.organizationId ?? ORGANIZATION_ID,
      teamIds: "team-1, team-2",
      teamAssignments: null,
      role: "MEMBER",
      requestedBy: ADMIN.id,
      subscriptionId: seed.subscriptionId ?? null,
      acceptedByUserId: seed.acceptedByUserId ?? null,
      acceptedViaIdentifierId: null,
      createdAt: seed.createdAt,
      updatedAt: seed.createdAt,
    });
  }
  return OrganizationModule.create(setup);
}

describe("OrganizationModule.findInviteFacts", () => {
  describe("given invitations in every status", () => {
    const now = nowInstant();
    const seeds: Seed[] = [
      {
        id: "invite-accepted",
        status: "ACCEPTED",
        createdAt: now.subtract({ hours: 5 }),
        expiration: null,
        acceptedByUserId: "user-joined",
      },
      {
        id: "invite-expired",
        status: "PENDING",
        createdAt: now.subtract({ hours: 4 }),
        expiration: now.subtract({ hours: 1 }),
      },
      {
        id: "invite-revoked",
        status: "REVOKED",
        createdAt: now.subtract({ hours: 3 }),
        expiration: null,
      },
      {
        id: "invite-checkout",
        status: "PAYMENT_PENDING",
        createdAt: now.subtract({ hours: 2 }),
        expiration: null,
        subscriptionId: "sub-1",
      },
      {
        id: "invite-pending",
        status: "PENDING",
        createdAt: now.subtract({ hours: 1 }),
        expiration: now.add({ hours: 47 }),
      },
      {
        id: "invite-elsewhere",
        status: "PENDING",
        createdAt: now,
        expiration: null,
        organizationId: "org-other",
      },
    ];

    it("answers each of this organization's invitations, newest first, with the status a person sees", async () => {
      const app = await application(seeds);

      const facts = await app.findInviteFacts({ organizationId: ORGANIZATION_ID });

      expect(facts.map(({ inviteId, status }) => [inviteId, status])).toEqual([
        ["invite-pending", "PENDING"],
        ["invite-checkout", "PAYMENT_PENDING"],
        ["invite-revoked", "REVOKED"],
        ["invite-expired", "EXPIRED"],
        ["invite-accepted", "ACCEPTED"],
      ]);
      expect(facts[1]).toMatchObject({ viaCheckout: true, teamIds: ["team-1", "team-2"] });
      expect(facts[4]).toMatchObject({
        acceptedByUserId: "user-joined",
        requestedByUserId: ADMIN.id,
        role: "MEMBER",
        billingOnly: false,
        expiresAt: null,
      });
    });

    it("carries no address, code or link", async () => {
      const app = await application(seeds);

      const text = JSON.stringify(await app.findInviteFacts({ organizationId: ORGANIZATION_ID }));

      for (const word of ["@", "code-", "http"]) expect(text).not.toContain(word);
    });
  });

  describe("given an organization with no invitations", () => {
    it("answers an empty list", async () => {
      const app = await application([]);

      await expect(app.findInviteFacts({ organizationId: ORGANIZATION_ID })).resolves.toEqual([]);
    });
  });
});
