// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 *
 * Every way a person can arrive through a customer's directory, crossed with
 * every state their account can already be in — against real Postgres.
 *
 * THE QUESTION THIS FILE ANSWERS FIRST. A connection's arrival policy says
 * what happens to somebody who SIGNS IN and is not a member yet: they join,
 * they ask and wait, or they are turned away. A SCIM push is not that. It is
 * the customer's own directory, holding a token their administrator issued,
 * stating that this person belongs in this organization. There is nobody to
 * ask and nothing to decide — the administrator already decided, in their
 * identity provider, which is the whole point of buying directory sync.
 *
 * So a push provisions on every policy, and the cases below assert that
 * deliberately rather than by omission. Getting this wrong in either
 * direction is a bad day: consult the policy and a `refuse` connection
 * silently drops everybody the directory sends, which reads as SCIM being
 * broken; ignore it in the sign-in path instead and an unmatched stranger
 * walks in. Two doors, two rules, and they are not the same rule.
 *
 * The second half is the lifecycle nobody writes down: what a re-push does
 * after a removal. Directories re-push constantly — a full sync on a
 * schedule, a retry after a 500, an administrator hitting "push now" — so
 * "what happens the second time" is the normal case rather than the edge.
 *
 * Spec: specs/identity/scim-connection-sync.feature.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { ScimService } from "../scim.service";
import type { ScimCreateUserRequest, ScimUser } from "../scim.types";

// Removing somebody revokes their sessions, which decides through the App
// singleton. Without it a DELETE dies at the boundary rather than at the
// behaviour under test.
wireDefaultTestApp();

const CORE_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";

const ns = `scim-arrival-${nanoid(8)}`;
const ORG = `org-${ns}`;
const CONNECTION = `ssoc-${ns}`;

const scim = () => ScimService.create({ prisma });

const push = (
  email: string,
  externalId: string | null = null,
): ScimCreateUserRequest =>
  ({
    schemas: [CORE_SCHEMA],
    userName: email,
    name: { givenName: "Sam", familyName: "Rivers" },
    active: true,
    ...(externalId === null ? {} : { externalId }),
  }) as ScimCreateUserRequest;

const isError = (result: ScimUser | { status?: string } | null): boolean =>
  result !== null && "status" in (result as Record<string, unknown>);

const memberships = (email: string) =>
  prisma.organizationUser.findMany({
    where: { organizationId: ORG, user: { email } },
  });

const userFor = (email: string) =>
  prisma.user.findFirst({ where: { email } });

/**
 * Put the connection on one of the three answers. The push must not care,
 * which is exactly what the first block asserts.
 */
const connectionAdmitting = async (policy: "admit" | "request" | "refuse") => {
  await prisma.ssoConnection.upsert({
    where: { id: CONNECTION },
    create: {
      id: CONNECTION,
      organizationId: ORG,
      type: "oidc",
      state: "ACTIVE",
      idpMetadata: { providerId: "okta", issuer: null },
      arrivalPolicy: policy,
      verifiedDomains: ["acme.test"],
      source: "self-serve",
      occurredAt: new Date(),
      lastEventId: `evt-${nanoid(6)}`,
      acceptedAt: new Date(),
      projectionVersion: "1",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    update: { arrivalPolicy: policy },
  });
};

beforeAll(async () => {
  await startTestContainers();
  await prisma.organization.create({
    data: { id: ORG, name: ns, slug: ORG },
  });
}, 60_000);

afterAll(async () => {
  await prisma.scimExternalId.deleteMany({ where: { connectionId: CONNECTION } });
  await prisma.roleBinding.deleteMany({ where: { organizationId: ORG } });
  await prisma.organizationUser.deleteMany({ where: { organizationId: ORG } });
  await prisma.user.deleteMany({ where: { email: { contains: ns } } });
  await prisma.ssoConnection.deleteMany({ where: { id: CONNECTION } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
  await stopTestContainers();
});

describe("given a directory pushing somebody who has no account here", () => {
  describe.each(["admit", "request", "refuse"] as const)(
    "when the connection's arrival policy is '%s'",
    (policy) => {
      /** @scenario "A directory push provisions whatever the sign-in door would do" */
      it("makes the account and the membership, because the administrator already decided", async () => {
        const email = `new-${policy}-${ns}@acme.test`;
        await connectionAdmitting(policy);

        const result = await scim().createUser({
          request: push(email, `ext-new-${policy}`),
          organizationId: ORG,
          connectionId: CONNECTION,
        });

        expect(isError(result)).toBe(false);
        expect(await userFor(email)).not.toBeNull();
        // Even on `refuse`. The policy governs the SIGN-IN door: somebody
        // who turns up at it unannounced. A push is the customer's own
        // directory saying this person belongs, which is not a question.
        expect(await memberships(email)).toHaveLength(1);
      });
    },
  );
});

describe("given a directory pushing somebody who already has an account", () => {
  describe("when they are not a member of this organization yet", () => {
    /** @scenario "A directory adopts a member who already had an account" */
    it("adopts the account rather than making a second one", async () => {
      const email = `existing-${ns}@acme.test`;
      await connectionAdmitting("refuse");
      const existing = await prisma.user.create({
        data: { id: `u-existing-${ns}`, email, name: "Sam" },
      });

      const result = await scim().createUser({
        request: push(email, `ext-existing`),
        organizationId: ORG,
        connectionId: CONNECTION,
      });

      expect(isError(result)).toBe(false);
      // ONE user. Resolving on the address is what lets a directory adopt
      // somebody an administrator invited by hand, or somebody who signed up
      // for themselves before the company bought single sign-on.
      const all = await prisma.user.findMany({ where: { email } });
      expect(all.map((row) => row.id)).toEqual([existing.id]);
      expect(await memberships(email)).toHaveLength(1);
    });
  });

  describe("when they are already a member", () => {
    /** @scenario "A directory push that changes nothing changes nothing" */
    it("refuses the duplicate rather than making a second membership", async () => {
      const email = `already-${ns}@acme.test`;
      await connectionAdmitting("admit");
      await scim().createUser({
        request: push(email, "ext-already"),
        organizationId: ORG,
        connectionId: CONNECTION,
      });

      const again = await scim().createUser({
        request: push(email, "ext-already"),
        organizationId: ORG,
        connectionId: CONNECTION,
      });

      expect(again).toMatchObject({ status: "409" });
      expect(await memberships(email)).toHaveLength(1);
    });
  });

  describe("when their address changed between two pushes", () => {
    /** @scenario "A directory push follows the person, not the address" */
    it("follows the directory's own identifier and makes nobody new", async () => {
      const before = `renamed-before-${ns}@acme.test`;
      const after = `renamed-after-${ns}@acme.test`;
      await connectionAdmitting("admit");
      await scim().createUser({
        request: push(before, "ext-renamed"),
        organizationId: ORG,
        connectionId: CONNECTION,
      });

      const second = await scim().createUser({
        request: push(after, "ext-renamed"),
        organizationId: ORG,
        connectionId: CONNECTION,
      });

      // Same externalId, new address: the same person. Resolving on the
      // address alone would have made them a stranger and given the
      // organization two of them.
      expect(second).toMatchObject({ status: "409" });
      expect(await userFor(after)).toBeNull();
    });
  });
});

describe("given somebody the directory removed", () => {
  const email = `removed-${ns}@acme.test`;

  describe("when the directory pushes them again afterwards", () => {
    /** @scenario "A removed person the directory pushes again comes back" */
    it("brings them back with a membership, and with no second account", async () => {
      await connectionAdmitting("admit");
      const created = await scim().createUser({
        request: push(email, "ext-removed"),
        organizationId: ORG,
        connectionId: CONNECTION,
      });
      const id = (created as ScimUser).id;

      const removed = await scim().deleteUser({
        id,
        organizationId: ORG,
        connectionId: CONNECTION,
      });
      expect(removed).toBeNull();
      expect(await memberships(email)).toHaveLength(0);

      // The re-push. This is the ordinary case, not an edge: directories run
      // a full sync on a schedule and re-assert everybody in them.
      const back = await scim().createUser({
        request: push(email, "ext-removed"),
        organizationId: ORG,
        connectionId: CONNECTION,
      });

      expect(isError(back)).toBe(false);
      expect(await memberships(email)).toHaveLength(1);
      const all = await prisma.user.findMany({ where: { email } });
      expect(all).toHaveLength(1);
    });
  });

  describe("when they were removed and never pushed again", () => {
    /** @scenario "A removal leaves nothing behind in the organization" */
    it("leaves them no membership and no role binding here", async () => {
      const gone = `gone-${ns}@acme.test`;
      await connectionAdmitting("admit");
      const created = await scim().createUser({
        request: push(gone, "ext-gone"),
        organizationId: ORG,
        connectionId: CONNECTION,
      });

      await scim().deleteUser({
        id: (created as ScimUser).id,
        organizationId: ORG,
        connectionId: CONNECTION,
      });

      expect(await memberships(gone)).toHaveLength(0);
      expect(
        await prisma.roleBinding.findMany({
          where: { organizationId: ORG, userId: (created as ScimUser).id },
        }),
      ).toHaveLength(0);
      // The ACCOUNT survives a removal from one organization. They may be in
      // another, and their sign-in is not this organization's to delete.
      expect(await userFor(gone)).not.toBeNull();
    });
  });

  describe("when the directory removes somebody it never pushed", () => {
    it("answers not-found rather than removing anything", async () => {
      const stranger = await prisma.user.create({
        data: { id: `u-stranger-${ns}`, email: `stranger-${ns}@acme.test`, name: "Nobody" },
      });

      expect(
        await scim().deleteUser({
          id: stranger.id,
          organizationId: ORG,
          connectionId: CONNECTION,
        }),
      ).toMatchObject({ status: "404" });
    });
  });
});
