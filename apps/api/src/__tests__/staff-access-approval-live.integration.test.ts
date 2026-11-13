/**
 * The staff access approval path end to end on the live api and worker: a signed-in operator
 * with a software passkey enrols an agent, approves its request with a real signature, and the
 * agent redeems from its own address. A person without the operator grant is refused.
 * @vitest-environment node
 * @see modules/staff-access/specs/staff-access-approval.feature
 */
import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";

import type { PasskeyAssertionResponse } from "@langwatch/auth-contract";
import {
  AUTHZ_ENGINE_MIGRATION_NAME,
  PLATFORM_OPERATOR_ROLE_ID,
  PLATFORM_TENANT_ID,
} from "@langwatch/authz-contract";
import { generate } from "@langwatch/ksuid";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  bootLiveApi,
  callTrpc,
  liveStoresConfigured,
  openLivePrisma,
  removeSignedUpRows,
  seedProject,
  signUpSession,
  type LiveApi,
  type LiveSession,
} from "./api-live.fixture.ts";

const FLAG = "ops_agent_access_enabled";
const AGENT_IP = "203.0.113.7";
const OTHER_IP = "203.0.113.99";
const VERIFIER = "v".repeat(43);
const CODE_CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const REASON = "check ACME's organization settings";

const USER_PRESENT = 0x01;
const USER_VERIFIED = 0x04;

/** One CBOR byte string header for a 32-byte value (major type 2, one length byte). */
const cborBytes32 = (bytes: Buffer) => Buffer.concat([Buffer.from([0x58, 0x20]), bytes]);

/** A P-256 authenticator held in the test: it signs exactly what a browser would hand back. */
class SoftwareAuthenticator {
  readonly credentialId = Buffer.from(randomUUID()).toString("base64url");
  private readonly privateKey: KeyObject;
  readonly cosePublicKey: string;
  private counter = 0;

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: "jwk" });
    // COSE_Key {1: 2 (EC2), 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y}
    const cose = Buffer.concat([
      Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21]),
      cborBytes32(Buffer.from(jwk.x ?? "", "base64url")),
      Buffer.from([0x22]),
      cborBytes32(Buffer.from(jwk.y ?? "", "base64url")),
    ]);
    this.cosePublicKey = cose.toString("base64");
  }

  assert({
    challenge,
    rpId,
    origin,
  }: {
    challenge: string;
    rpId: string;
    origin: string;
  }): PasskeyAssertionResponse {
    this.counter += 1;
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    const authenticatorData = Buffer.concat([
      createHash("sha256").update(rpId).digest(),
      Buffer.from([USER_PRESENT | USER_VERIFIED]),
      counter,
    ]);
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge, origin, crossOrigin: false }),
    );
    const signature = sign(
      "sha256",
      Buffer.concat([authenticatorData, createHash("sha256").update(clientDataJSON).digest()]),
      this.privateKey,
    );
    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: "public-key",
      response: {
        clientDataJSON: clientDataJSON.toString("base64url"),
        authenticatorData: authenticatorData.toString("base64url"),
        signature: signature.toString("base64url"),
      },
      clientExtensionResults: {},
    };
  }
}

const optionsSchema = z.object({ challenge: z.string(), rpId: z.string() });
const enrolledSchema = z.object({ requesterKey: z.string() });
const overviewSchema = z.object({ hasPasskey: z.boolean() });
const createdSchema = z.object({ requestId: z.string() });
const redeemedSchema = z.object({ apiKey: z.string(), organizationId: z.string() });
const answerSchema = z.looseObject({ code: z.string().optional() });

describe.skipIf(!liveStoresConfigured)("given the staff access approval on the live api", () => {
  let api: LiveApi;
  let prisma: PrismaClient;
  let closePrisma: () => Promise<void>;
  let flagBefore: { enabled: boolean } | null;
  let operator: LiveSession;
  let stranger: LiveSession;
  const authenticator = new SoftwareAuthenticator();
  const ns = generate("test").toString().toLowerCase();
  const acme = { id: "", slug: `--test-org-acme-approval-${ns}`, projectId: "", teamId: "" };
  const requestIds: string[] = [];

  async function rest({
    path,
    bearer,
    body,
    ip,
  }: {
    path: string;
    bearer: string;
    body: unknown;
    ip: string;
  }) {
    const response = await api.fetch(path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "x-forwarded-for": ip,
        "user-agent": "langwatch-cli",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const json: unknown = (() => {
      try {
        return text ? JSON.parse(text) : undefined;
      } catch {
        return undefined;
      }
    })();
    const parsed = answerSchema.safeParse(json);
    return {
      status: response.status,
      code: parsed.success ? parsed.data.code : undefined,
      json,
      text,
    };
  }

  /** Asks the procedure until the folded grant lets the operator through, or gives up. */
  async function untilOperator(session: LiveSession) {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const answered = await callTrpc({
        api,
        path: "staffAccess.overview",
        kind: "query",
        session,
      });
      if (answered.status === 200 || Date.now() > deadline) return answered;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  beforeAll(async () => {
    ({ prisma, close: closePrisma } = openLivePrisma({ label: "staff-access-approval-live" }));
    flagBefore = await prisma.featureFlag.findUnique({ where: { key: FLAG } });
    await prisma.featureFlag.upsert({
      where: { key: FLAG },
      create: { key: FLAG, enabled: true },
      update: { enabled: true },
    });

    const organization = await prisma.organization.create({
      data: { name: "ACME", slug: acme.slug },
    });
    acme.id = organization.id;
    const team = await prisma.team.create({
      data: { name: "ACME team", slug: `${acme.slug}-team`, organizationId: acme.id },
    });
    acme.teamId = team.id;
    acme.projectId = (await seedProject({ prisma, teamId: team.id, label: "acme-approval" })).id;
    await prisma.systemMigrationTenantState.create({
      data: {
        migrationName: AUTHZ_ENGINE_MIGRATION_NAME,
        tenantId: acme.id,
        status: "finalized",
        occurredAt: new Date(),
      },
    });

    // Cloud ops is on only where the licence key matches, or on a developer's own stack.
    api = await bootLiveApi({ environment: { NODE_ENV: "development" }, withWorker: true });

    operator = await signUpSession({ api, label: "staff-approval-operator" });
    stranger = await signUpSession({ api, label: "staff-approval-stranger" });
    await prisma.grant.create({
      data: {
        id: `grant-platform-staff-approval-${ns}`,
        organizationId: PLATFORM_TENANT_ID,
        principalType: "USER",
        principalId: operator.userId,
        roleKey: PLATFORM_OPERATOR_ROLE_ID,
        source: "grants-service",
        scopeType: "PLATFORM",
        scopeId: PLATFORM_TENANT_ID,
        occurredAt: new Date(),
      },
    });
    await prisma.passkey.create({
      data: {
        userId: operator.userId,
        credentialID: authenticator.credentialId,
        publicKey: authenticator.cosePublicKey,
        counter: 0,
        deviceType: "singleDevice",
        transports: "internal",
      },
    });
  }, 480_000);

  afterAll(async () => {
    await api?.close();
    if (!prisma) return;
    if (requestIds.length > 0) {
      await prisma.staffAccessEvent.deleteMany({ where: { requestId: { in: requestIds } } });
    }
    const userIds = [operator?.userId, stranger?.userId].filter((id): id is string => Boolean(id));
    if (userIds.length > 0) {
      await prisma.staffAccessRequest.deleteMany({ where: { ownerUserId: { in: userIds } } });
      await prisma.staffAccessRequester.deleteMany({ where: { ownerUserId: { in: userIds } } });
      await prisma.staffAccessChallenge.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.passkey.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.grant.deleteMany({
        where: { organizationId: PLATFORM_TENANT_ID, principalId: { in: userIds } },
      });
    }
    if (flagBefore) {
      await prisma.featureFlag.update({ where: { key: FLAG }, data: flagBefore });
    } else {
      await prisma.featureFlag.deleteMany({ where: { key: FLAG } });
    }
    if (acme.id) {
      const where = { organizationId: acme.id };
      await prisma.auditLog.deleteMany({ where });
      await prisma.apiKey.deleteMany({ where });
      await prisma.grant.deleteMany({ where });
      await prisma.roleBinding.deleteMany({ where });
      await prisma.systemMigrationTenantState.deleteMany({ where: { tenantId: acme.id } });
      await prisma.project.deleteMany({ where: { id: acme.projectId } });
      await prisma.team.deleteMany({ where });
      await prisma.organization.deleteMany({ where: { id: acme.id } });
    }
    const founded =
      userIds.length > 0
        ? await prisma.organizationUser.findMany({
            where: { userId: { in: userIds } },
            select: { organizationId: true },
          })
        : [];
    await removeSignedUpRows({
      prisma,
      userIds,
      organizationIds: [...new Set(founded.map(({ organizationId }) => organizationId))],
    });
    await closePrisma();
  }, 120_000);

  describe("when the operator enrols an agent, approves its request with a passkey and the agent redeems", () => {
    /** @scenario "A real passkey approval lands in the audit log and the agent redeems it" */
    it("approves, writes the audit row, refuses another address and redeems a key", async () => {
      const ready = await untilOperator(operator);
      expect(ready.status, ready.body).toBe(200);
      expect(overviewSchema.parse(ready.data).hasPasskey).toBe(true);
      const origin = api.baseUrl;

      // A void mutation goes without a body, as the tRPC client sends it.
      const enrolOptions = await api.fetch("/api/trpc/staffAccess.enrolOptions", {
        method: "POST",
        headers: { ...operator.headers, "content-type": "application/json" },
      });
      const enrolOptionsBody = await enrolOptions.text();
      expect(enrolOptions.status, enrolOptionsBody).toBe(200);
      const enrolChallenge = optionsSchema.parse(
        z.object({ result: z.object({ data: z.unknown() }) }).parse(JSON.parse(enrolOptionsBody))
          .result.data,
      );
      expect(enrolChallenge.rpId).toBe(new URL(origin).hostname);
      const enrolled = await callTrpc({
        api,
        path: "staffAccess.enrol",
        kind: "mutation",
        session: operator,
        input: {
          name: "laptop agent",
          assertion: authenticator.assert({ ...enrolChallenge, origin }),
        },
      });
      expect(enrolled.status, enrolled.body).toBe(200);
      const { requesterKey } = enrolledSchema.parse(enrolled.data);

      const asked = await rest({
        path: "/api/staff-access/requests",
        bearer: requesterKey,
        ip: AGENT_IP,
        body: {
          scopes: ["org:metadata"],
          organization: acme.slug,
          reason: REASON,
          codeChallenge: CODE_CHALLENGE,
          codeChallengeMethod: "S256",
          machine: "operator-macbook",
        },
      });
      expect(asked.status, asked.text).toBe(200);
      const { requestId } = createdSchema.parse(asked.json);
      requestIds.push(requestId);

      const choice = { requestId, spendApproved: false };
      const approvalOptions = await callTrpc({
        api,
        path: "staffAccess.approvalOptions",
        kind: "mutation",
        session: operator,
        input: choice,
      });
      expect(approvalOptions.status, approvalOptions.body).toBe(200);
      const approvalChallenge = optionsSchema.parse(approvalOptions.data);
      const approved = await callTrpc({
        api,
        path: "staffAccess.approve",
        kind: "mutation",
        session: operator,
        input: { ...choice, assertion: authenticator.assert({ ...approvalChallenge, origin }) },
      });
      expect(approved.status, approved.body).toBe(200);

      const row = await prisma.staffAccessRequest.findUniqueOrThrow({ where: { id: requestId } });
      expect(row.status).toBe("approved");
      expect(row.approvalCredentialId).toBe(authenticator.credentialId);
      expect(row.signedHash).toBe(approvalChallenge.challenge);
      const audit = await prisma.auditLog.findMany({
        where: { organizationId: acme.id, action: "staffAccess.approved", targetId: requestId },
      });
      expect(audit).toHaveLength(1);
      expect(
        z.looseObject({ approvedBy: z.looseObject({ id: z.string() }) }).parse(audit[0]?.metadata)
          .approvedBy.id,
      ).toBe(operator.userId);

      const elsewhere = await rest({
        path: `/api/staff-access/requests/${requestId}/redeem`,
        bearer: requesterKey,
        ip: OTHER_IP,
        body: { codeVerifier: VERIFIER },
      });
      expect({ status: elsewhere.status, code: elsewhere.code }).toEqual({
        status: 403,
        code: "staff_access_ip_mismatch",
      });

      const redeemed = await rest({
        path: `/api/staff-access/requests/${requestId}/redeem`,
        bearer: requesterKey,
        ip: AGENT_IP,
        body: { codeVerifier: VERIFIER },
      });
      expect(redeemed.status, redeemed.text).toBe(200);
      const { apiKey, organizationId } = redeemedSchema.parse(redeemed.json);
      expect(apiKey.length).toBeGreaterThan(0);
      expect(organizationId).toBe(acme.id);
    }, 90_000);
  });

  describe("when a person without the operator grant asks the staff access procedures", () => {
    /** @scenario "Staff access procedures refuse a person without the operator grant" */
    it("refuses the overview and the kill switch, and no session is revoked", async () => {
      const liveBefore = await prisma.staffAccessRequest.findMany({
        where: { id: { in: requestIds } },
        select: { id: true, status: true, revokedAt: true },
      });

      const overview = await callTrpc({
        api,
        path: "staffAccess.overview",
        kind: "query",
        session: stranger,
      });
      const revokeAll = await callTrpc({
        api,
        path: "staffAccess.revokeAll",
        kind: "mutation",
        session: stranger,
        input: { confirmation: "revoke all" },
      });

      expect({ status: overview.status, code: overview.code }).toEqual({
        status: 404,
        code: "NOT_FOUND",
      });
      expect({ status: revokeAll.status, code: revokeAll.code }).toEqual({
        status: 404,
        code: "NOT_FOUND",
      });
      expect(
        await prisma.staffAccessRequest.findMany({
          where: { id: { in: requestIds } },
          select: { id: true, status: true, revokedAt: true },
        }),
      ).toEqual(liveBefore);
    }, 30_000);
  });
});
