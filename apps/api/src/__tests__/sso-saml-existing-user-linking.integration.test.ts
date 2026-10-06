/**
 * @vitest-environment node
 * Signed SAML sessions of existing and new users through the sign-in door of the api booted
 * wholly live, with the worker beside it, over Postgres, Redis and ClickHouse (§7). Only the
 * identity provider is a stand-in: it signs responses with a key generated when the suite runs.
 * @see specs/identity/saml-existing-user-linking.feature
 */
import { inflateRawSync } from "node:zlib";

import { AuthApi } from "@langwatch/auth-contract";
import { createSigningIdentity, signSamlResponse } from "@langwatch/test-harness/saml-signer";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  bootLiveApi,
  type LiveApi,
  liveStoresConfigured,
  openLivePrisma,
} from "./api-live.fixture.ts";

const database = liveStoresConfigured ? openLivePrisma({ label: "sso-saml-linking" }) : null;
const prisma = database?.prisma as NonNullable<typeof database>["prisma"];

const SUITE = nanoid(8)
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "x");
const IDP_ENTITY_ID = `https://idp-${SUITE}.saml-linking-test.example/entity`;
const IDP_SSO_URL = `https://idp-${SUITE}.saml-linking-test.example/sso`;

/** Identity's identifier backfill, as the runner and the arrival both key its per-tenant state. */
const D01_MIGRATION = "identity-d01-identifier-backfill";
const organizationIds: string[] = [];
const connectionIds: string[] = [];
const userIds: string[] = [];
let browsers = 0;

const startedSchema = z.object({ url: z.string() });
const sessionSchema = z.object({ user: z.object({ id: z.string() }) }).nullable();

const cookiesOf = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((set) => set.split(";")[0])
    .join("; ");

vi.setConfig({ testTimeout: 90_000 });

describe.skipIf(!liveStoresConfigured)("signed SAML sessions of existing and new users", () => {
  const identity = createSigningIdentity();
  let api: LiveApi;

  beforeAll(async () => {
    api = await bootLiveApi({ withWorker: true });
  }, 300_000);

  afterAll(async () => {
    await api?.close();
    for (const userId of userIds) {
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.account.deleteMany({ where: { userId } });
      await prisma.identifier.deleteMany({ where: { userId } });
      await prisma.organizationUser.deleteMany({
        where: { userId, organizationId: { in: organizationIds } },
      });
      await prisma.systemMigrationTenantState.deleteMany({ where: { tenantId: userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.ssoProvider.deleteMany({ where: { providerId: { in: connectionIds } } });
    await prisma.ssoConnection.deleteMany({ where: { id: { in: connectionIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await database?.close();
  });

  async function connect({ label }: { label: string }) {
    const providerId = `ssoc_saml_${label}_${SUITE}`;
    const organizationId = `saml-linking-${label}-${SUITE}`;
    const domain = `${label}-${SUITE}.saml-linking-test.example`;
    const spEntityId = `${api.baseUrl}/api/auth/sso/saml2/sp`;
    const acs = `${api.baseUrl}/api/auth/sso/saml2/sp/acs/${providerId}`;
    const now = new Date();
    organizationIds.push(organizationId);
    connectionIds.push(providerId);
    await prisma.organization.create({
      data: { id: organizationId, name: label, slug: organizationId },
    });
    await prisma.ssoConnection.create({
      data: {
        id: providerId,
        organizationId,
        type: "saml",
        state: "ACTIVE",
        claimedDomains: [domain],
        approvedDomains: [domain],
        verifiedDomains: [domain],
        domainVerifications: [
          {
            domain,
            method: "dns-txt",
            actorId: null,
            verifiedAtMs: now.getTime(),
            proofState: "VERIFIED",
            firstAbsentAtMs: null,
            graceEndsAtMs: null,
            tokenHash: "sha256:test",
            evidenceRef: "sha256:test",
            note: null,
            verifier: { type: "system", id: "test" },
          },
        ],
        lapsedDomains: [],
        idpMetadata: {
          issuer: IDP_ENTITY_ID,
          providerId,
          clientIdRef: null,
          secretRef: null,
          certRefs: [],
        },
        arrivalPolicy: "admit",
        arrivalPolicyDecidedAt: now,
        source: "self-serve",
        occurredAt: now,
        lastEventId: `event-${providerId}`,
        acceptedAt: now,
        projectionVersion: "1",
        createdAt: now,
        updatedAt: now,
      },
    });
    await prisma.ssoProvider.create({
      data: {
        id: providerId,
        providerId,
        issuer: IDP_ENTITY_ID,
        organizationId,
        domain,
        samlConfig: JSON.stringify({
          entryPoint: IDP_SSO_URL,
          cert: identity.certificatePem,
          idpMetadata: { entityID: IDP_ENTITY_ID },
          spMetadata: { entityID: spEntityId },
          wantAssertionsSigned: true,
          mapping: { id: "nameID", email: "email" },
        }),
      },
    });
    return { providerId, organizationId, domain, spEntityId, acs };
  }

  type Connection = Awaited<ReturnType<typeof connect>>;

  /** A local account with a verified address and a password, as sign-up leaves it. */
  async function localUser({ email }: { email: string }) {
    const user = await prisma.user.create({
      data: { email, emailVerified: true, name: "Preserved local name" },
    });
    userIds.push(user.id);
    const account = await prisma.account.create({
      data: {
        userId: user.id,
        type: "credential",
        provider: "credential",
        issuer: "credential",
        providerAccountId: user.id,
        password: "existing-password-hash",
      },
    });
    await prisma.identifier.create({
      data: {
        id: `idf_${nanoid()}`,
        userId: user.id,
        provider: "credential",
        value: email,
        accountId: account.id,
        providerId: "credential",
        providerAccountId: user.id,
        state: "VERIFIED",
        attachedAt: new Date(),
        verifiedAt: new Date(),
      },
    });
    return user;
  }

  /** A browser signing in: it starts at the connection and returns with a signed response. */
  async function signIn({ connection, email }: { connection: Connection; email: string }) {
    browsers += 1;
    const browser = { "x-forwarded-for": `203.0.113.${browsers}`, origin: api.baseUrl };
    const started = await api.fetch("/api/auth/sign-in/sso", {
      method: "POST",
      headers: { ...browser, "content-type": "application/json" },
      body: JSON.stringify({
        providerId: connection.providerId,
        callbackURL: `${api.baseUrl}/dashboard`,
      }),
    });
    const redirect = new URL(startedSchema.parse(await started.json()).url);
    const request = inflateRawSync(
      Buffer.from(redirect.searchParams.get("SAMLRequest") ?? "", "base64"),
    ).toString("utf8");
    const requestId = /ID="([^"]+)"/.exec(request)?.[1];
    const samlResponse = signSamlResponse({
      identity,
      claims: {
        issuer: IDP_ENTITY_ID,
        audience: connection.spEntityId,
        recipient: connection.acs,
        nameId: email,
        email,
        ...(requestId ? { inResponseTo: requestId } : {}),
      },
    });
    const callback = await api.fetch(new URL(connection.acs).pathname, {
      method: "POST",
      headers: {
        ...browser,
        "content-type": "application/x-www-form-urlencoded",
        cookie: cookiesOf(started),
      },
      body: new URLSearchParams({
        SAMLResponse: samlResponse,
        RelayState: redirect.searchParams.get("RelayState") ?? "",
      }),
      redirect: "manual",
    });
    const cookie = cookiesOf(callback);
    const readSession = async () => {
      const polled = await api.fetch("/api/auth/session", { headers: { ...browser, cookie } });
      return sessionSchema.parse(await polled.json());
    };
    return { status: callback.status, session: await readSession(), readSession };
  }

  /** The identifier the connection's projection holds for this user, once the worker wrote it. */
  const samlIdentifierOf = ({ userId, connection }: { userId: string; connection: Connection }) =>
    vi.waitFor(
      async () => {
        const row = await prisma.identifier.findFirst({
          where: { userId, providerId: connection.providerId },
        });
        if (!row) throw new Error("the SAML identifier is not projected yet");
        return row;
      },
      { timeout: 30_000, interval: 250 },
    );

  const sessionsOf = ({ userId }: { userId: string }) =>
    prisma.session.findMany({
      where: { userId },
      select: { id: true, identifierId: true, amr: true },
      orderBy: { createdAt: "asc" },
    });

  /** @scenario "The first SAML session stays revocable before projection catches up" */
  it("ends the first and repeated sessions of a SAML method and leaves historical ones alone", async () => {
    const connection = await connect({ label: "revocable" });
    const email = `member@${connection.domain}`;
    const user = await localUser({ email });

    const first = await signIn({ connection, email });
    expect(first.session?.user.id).toBe(user.id);
    const identifier = await samlIdentifierOf({ userId: user.id, connection });
    const repeated = await signIn({ connection, email });
    expect(repeated.session?.user.id).toBe(user.id);
    const historical = await prisma.session.create({
      data: {
        sessionToken: `historical-${nanoid()}`,
        userId: user.id,
        expires: new Date(Date.now() + 3_600_000),
      },
    });
    const minted = (await sessionsOf({ userId: user.id })).filter((s) => s.id !== historical.id);
    expect(minted.map((s) => s.identifierId)).toEqual([identifier.id, identifier.id]);

    const ended = await api.application
      .service(AuthApi)
      .endBrowserSessionsForIdentifier({ userId: user.id, identifierId: identifier.id });

    expect(ended.ended).toBe(2);
    expect(await first.readSession()).toBeNull();
    expect(await repeated.readSession()).toBeNull();
    const remaining = await sessionsOf({ userId: user.id });
    expect(remaining).toEqual([expect.objectContaining({ id: historical.id, identifierId: null })]);
  });

  /** @scenario "A fresh SAML callback adopts identity before its first session is used" */
  it("adopts a fresh address, records D01 finalized and the generated identifier on its first session", async () => {
    const connection = await connect({ label: "fresh" });
    const email = `newcomer@${connection.domain}`;

    const first = await signIn({ connection, email });
    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    userIds.push(user.id);
    expect(first.session?.user.id).toBe(user.id);
    const identifier = await samlIdentifierOf({ userId: user.id, connection });
    const d01 = { migrationName: D01_MIGRATION, tenantId: user.id };
    await vi.waitFor(
      async () => {
        const row = await prisma.systemMigrationTenantState.findUnique({
          where: { migrationName_tenantId: d01 },
        });
        if (row?.status !== "finalized")
          throw new Error("D01 is not finalized for the arrival yet");
      },
      { timeout: 30_000, interval: 250 },
    );
    const again = await signIn({ connection, email });

    expect(again.session?.user.id).toBe(user.id);
    expect(await prisma.systemMigrationTenantState.count({ where: d01 })).toBe(1);
    expect((await sessionsOf({ userId: user.id })).map((s) => s.identifierId)).toEqual([
      identifier.id,
      identifier.id,
    ]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified).toBe(
      false,
    );
    expect(await prisma.user.count({ where: { email } })).toBe(1);
    expect(
      await prisma.account.count({ where: { userId: user.id, provider: connection.providerId } }),
    ).toBe(1);
    expect(
      await prisma.organizationUser.count({
        where: { userId: user.id, organizationId: connection.organizationId },
      }),
    ).toBe(1);
  });

  /** @scenario "Unprojected session attribution refuses uncertain account evidence" */
  it("records no identifier when the callback's account evidence is detached or conflicting", async () => {
    const connection = await connect({ label: "uncertain" });
    const detachedEmail = `detached@${connection.domain}`;
    const conflictedEmail = `conflicted@${connection.domain}`;
    const detachedUser = await localUser({ email: detachedEmail });
    const conflictedUser = await localUser({ email: conflictedEmail });
    await signIn({ connection, email: detachedEmail });
    await signIn({ connection, email: conflictedEmail });
    const detached = await samlIdentifierOf({ userId: detachedUser.id, connection });
    const conflicted = await samlIdentifierOf({ userId: conflictedUser.id, connection });
    await prisma.identifier.update({
      where: { id: detached.id },
      data: { state: "DETACHED", detachedAt: new Date() },
    });
    await prisma.identifier.update({
      where: { id: conflicted.id },
      data: { providerAccountId: `another-subject-${SUITE}` },
    });

    const afterDetach = await signIn({ connection, email: detachedEmail });
    const afterConflict = await signIn({ connection, email: conflictedEmail });

    expect(afterDetach.session?.user.id).toBe(detachedUser.id);
    expect(afterConflict.session?.user.id).toBe(conflictedUser.id);
    expect((await sessionsOf({ userId: detachedUser.id })).at(-1)?.identifierId).toBeNull();
    expect((await sessionsOf({ userId: conflictedUser.id })).at(-1)?.identifierId).toBeNull();
    const identifiers = await prisma.identifier.findMany({
      where: {
        userId: { in: [detachedUser.id, conflictedUser.id] },
        providerId: connection.providerId,
      },
    });
    expect(identifiers.map((row) => row.id).toSorted()).toEqual(
      [detached.id, conflicted.id].toSorted(),
    );
  });

  /** @scenario "Repeated SAML sessions retain their exact sign-in method" */
  it("records the exact identifier on each repeated session and revokes them together", async () => {
    const connection = await connect({ label: "repeated" });
    const email = `member@${connection.domain}`;
    const user = await localUser({ email });
    await signIn({ connection, email });
    const identifier = await samlIdentifierOf({ userId: user.id, connection });

    const second = await signIn({ connection, email });
    const third = await signIn({ connection, email });

    const sessions = await sessionsOf({ userId: user.id });
    expect(sessions).toHaveLength(3);
    expect(sessions.map((s) => s.identifierId)).toEqual([
      identifier.id,
      identifier.id,
      identifier.id,
    ]);
    expect(sessions.flatMap((s) => s.amr)).toEqual([]);
    await api.application
      .service(AuthApi)
      .endBrowserSessionsForIdentifier({ userId: user.id, identifierId: identifier.id });
    expect(await second.readSession()).toBeNull();
    expect(await third.readSession()).toBeNull();
    expect(await sessionsOf({ userId: user.id })).toEqual([]);
  });
});
