/**
 * An organization's second-factor requirement across identity, auth and organization on the api
 * booted wholly live (§7). Only the plan is seeded: a licence signed by a key this suite makes.
 * @vitest-environment node
 * @see specs/identity/mfa-and-session-shape.feature
 */
import { createSign, generateKeyPairSync } from "node:crypto";

import type { LicenseData } from "@langwatch/enterprise-licensing-contract";
import { generate } from "@langwatch/ksuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  bootLiveApi,
  callTrpc,
  type LiveApi,
  type LiveSession,
  liveStoresConfigured,
  openLivePrisma,
  removeSignedUpRows,
  signUpSession,
} from "./api-live.fixture.ts";

const database = liveStoresConfigured
  ? openLivePrisma({ label: "identity-mfa-requirement" })
  : null;
const prisma = database?.prisma as NonNullable<typeof database>["prisma"];

const ns = generate("test").toString().toLowerCase();
const GATE_CODE = "identity_mfa_enrollment_required";

vi.setConfig({ testTimeout: 90_000 });

/** The licence an Enterprise organization holds: signed by a key pair only this suite knows. */
function signedEnterpriseLicense({ privateKey }: { privateKey: string }): string {
  const data: LicenseData = {
    licenseId: `lic-${ns}`,
    version: 1,
    organizationName: `Acme ${ns}`,
    email: "admin@acme.example",
    issuedAt: "2024-01-01T00:00:00Z",
    expiresAt: "2099-12-31T23:59:59Z",
    plan: {
      type: "ENTERPRISE",
      name: "Enterprise",
      maxMembers: 100,
      maxProjects: 500,
      maxMessagesPerMonth: 10_000_000,
      maxWorkflows: 1000,
      maxPrompts: 1000,
      maxEvaluators: 1000,
      maxScenarios: 1000,
      canPublish: true,
    },
  };
  const signature = createSign("SHA256").update(JSON.stringify(data)).sign(privateKey, "base64");

  return Buffer.from(JSON.stringify({ data, signature }), "utf-8").toString("base64");
}

describe.skipIf(!liveStoresConfigured)("an organization that requires a second factor", () => {
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const userIds: string[] = [];
  const organizationIds: string[] = [];
  let api: LiveApi;
  let acmeId: string;
  let acmeTeamId: string;

  async function invite({ person }: { person: LiveSession }) {
    const created = await callTrpc({
      api,
      path: "invite.createInvites",
      kind: "mutation",
      input: {
        organizationId: acmeId,
        invites: [
          { email: person.email, role: "MEMBER", teams: [{ teamId: acmeTeamId, role: "MEMBER" }] },
        ],
      },
      session: ana,
    });
    if (created.status !== 200) throw new Error(`invite refused: ${created.body}`);
    const [issued] = created.data as { invite: { inviteCode: string } }[];
    if (!issued) throw new Error(`no invitation was issued: ${created.body}`);
    return issued.invite.inviteCode;
  }

  const accept = ({ person, inviteCode }: { person: LiveSession; inviteCode: string }) =>
    callTrpc({
      api,
      path: "invite.acceptInvite",
      kind: "mutation",
      input: { inviteCode },
      session: person,
    });

  const askAcmeData = ({ person }: { person: LiveSession }) =>
    callTrpc({
      api,
      path: "organization.getOrganizationWithMembersAndTheirTeams",
      kind: "query",
      input: { organizationId: acmeId },
      session: person,
    });

  const askStanding = ({ person }: { person: LiveSession }) =>
    callTrpc({
      api,
      path: "twoStepVerification.standing",
      kind: "query",
      input: { organizationId: acmeId },
      session: person,
    });

  let ana: LiveSession;
  let sam: LiveSession;
  let kim: LiveSession;

  beforeAll(async () => {
    api = await bootLiveApi({
      withWorker: true,
      environment: { MFA_ENROLLMENT_OPEN: "on", LANGWATCH_LICENSE_PUBLIC_KEY: keys.publicKey },
    });
    [ana, sam, kim] = (await Promise.all(
      ["ana", "sam", "kim"].map((label) => signUpSession({ api, label })),
    )) as [LiveSession, LiveSession, LiveSession];
    userIds.push(ana.userId, sam.userId, kim.userId);

    const created = await callTrpc({
      api,
      path: "organization.createAndAssign",
      kind: "mutation",
      input: { orgName: `Acme ${ns}` },
      session: ana,
    });
    if (created.status !== 200) throw new Error(`founding refused: ${created.body}`);
    const founded = created.data as { organization: { id: string }; team: { id: string } };
    acmeId = founded.organization.id;
    acmeTeamId = founded.team.id;
    organizationIds.push(acmeId);
    await prisma.organization.update({
      where: { id: acmeId },
      data: { license: signedEnterpriseLicense({ privateKey: keys.privateKey }) },
    });
    const joined = await accept({ person: sam, inviteCode: await invite({ person: sam }) });
    if (joined.status !== 200) throw new Error(`sam could not join: ${joined.body}`);
  }, 300_000);

  afterAll(async () => {
    await api?.close();
    if (organizationIds.length > 0) {
      await prisma.organizationInvite.deleteMany({
        where: { organizationId: { in: organizationIds } },
      });
      await prisma.teamUser.deleteMany({
        where: { team: { organizationId: { in: organizationIds } } },
      });
      for (const tenantId of organizationIds) {
        await prisma.systemMigrationTenantState.deleteMany({ where: { tenantId } });
      }
    }
    if (organizationIds.length > 0) await removeSignedUpRows({ prisma, userIds, organizationIds });
    await database?.close();
  });

  describe("when an administrator turns the requirement on", () => {
    /** @scenario "Turning the requirement on ends no session" */
    it("ends not one session and leaves every member signed in to everything else", async () => {
      const held = userIds.filter((id) => id !== kim.userId);
      const before = await prisma.session.findMany({
        where: { userId: { in: held } },
        select: { id: true, userId: true, expires: true },
        orderBy: { id: "asc" },
      });
      expect(before.length).toBeGreaterThanOrEqual(2);
      expect((await askAcmeData({ person: sam })).status).toBe(200);

      const turnedOn = await callTrpc({
        api,
        path: "twoStepVerification.setRequirement",
        kind: "mutation",
        input: { organizationId: acmeId, mfaRequired: true },
        session: ana,
      });
      expect(turnedOn.status, turnedOn.body).toBe(200);
      expect(turnedOn.data).toEqual({ previous: false, next: true });

      const after = await prisma.session.findMany({
        where: { userId: { in: held } },
        select: { id: true, userId: true, expires: true },
        orderBy: { id: "asc" },
      });
      expect(after).toEqual(before);
      for (const person of [ana, sam]) {
        const everythingElse = await callTrpc({
          api,
          path: "twoStepVerification.account",
          kind: "query",
          input: {},
          session: person,
        });
        expect(everythingElse.status, everythingElse.body).toBe(200);
        expect((await askStanding({ person })).data).toMatchObject({
          required: true,
          satisfaction: { satisfied: false },
        });
      }
    });
  });

  describe("when someone joins an organization that already requires it", () => {
    /** @scenario "Someone joining an organization that requires it meets the gate on the way in" */
    it("makes them a member and holds them at the enrollment gate until they set one up", async () => {
      await prisma.organization.update({ where: { id: acmeId }, data: { mfaRequired: false } });
      const inviteCode = await invite({ person: kim });
      await prisma.organization.update({ where: { id: acmeId }, data: { mfaRequired: true } });
      expect(
        await prisma.organizationUser.count({
          where: { userId: kim.userId, organizationId: acmeId },
        }),
      ).toBe(0);

      const accepted = await accept({ person: kim, inviteCode });
      expect(accepted.status, accepted.body).toBe(200);

      expect(
        await prisma.organizationUser.count({
          where: { userId: kim.userId, organizationId: acmeId },
        }),
      ).toBe(1);
      expect((await askStanding({ person: kim })).data).toMatchObject({
        organizationId: acmeId,
        required: true,
        satisfaction: { satisfied: false },
      });
      const held = await askAcmeData({ person: kim });
      expect(held.status).not.toBe(200);
      expect(held.body).toContain(GATE_CODE);
    });
  });
});
