import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { twoFactor } from "better-auth/plugins/two-factor";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { LastWayInService } from "~/server/app-layer/identity/last-way-in.service";
import { requestHooks } from "../config/request-hooks";
import type { RequiringOrganizations } from "../last-way-in";
import { LastWayInGuard } from "../last-way-in";

type MemoryDB = Record<string, Record<string, unknown>[]>;
type AuthUnderTest = {
  handler: (request: Request) => Promise<Response>;
};

const baseURL = "http://localhost:3000";
const email = "last-way-in@example.com";
const password = "test-password-1";
const refusalSchema = z.object({ code: z.string(), message: z.string() });
const signUpSchema = z
  .object({ user: z.object({ id: z.string() }) })
  .passthrough();
const signInSchema = z
  .object({ user: z.object({ id: z.string() }) })
  .passthrough();

function rows(db: MemoryDB, model: string): Record<string, unknown>[] {
  return db[model] ?? [];
}

function stringField(
  row: Record<string, unknown>,
  field: string,
): string | null {
  const value = row[field];
  return typeof value === "string" ? value : null;
}

function addPasskey(db: MemoryDB, userId: string, id: string): void {
  rows(db, "passkey").push({
    id,
    userId,
    name: id,
    publicKey: "public-key",
    credentialID: id,
    counter: 0,
    deviceType: "singleDevice",
    backedUp: false,
  });
}

function removeCredentialPassword(db: MemoryDB, userId: string): void {
  const account = rows(db, "account").find(
    (row) => stringField(row, "userId") === userId,
  );
  if (!account)
    throw new Error("the signup did not create a credential account");
  account.password = null;
}

function responseCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("the response set no session cookie");
  return setCookie.split(";")[0] ?? "";
}

function post(path: string, body: Record<string, string>): Request {
  return new Request(`${baseURL}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function buildHarness() {
  const db: MemoryDB = {
    user: [],
    session: [],
    account: [],
    verification: [],
    passkey: [],
    twoFactor: [],
    organization: [],
    organizationMember: [],
  };
  const lastWayIn = new LastWayInService({
    records: {
      countOtherPasskeys: async ({ userId, exceptPasskeyId }) =>
        rows(db, "passkey").filter(
          (row) =>
            stringField(row, "userId") === userId &&
            stringField(row, "id") !== exceptPasskeyId,
        ).length,
      findCredentials: async ({ userId }) =>
        rows(db, "account")
          .filter((row) => stringField(row, "userId") === userId)
          .map((row) => ({
            provider: stringField(row, "providerId") ?? "",
            password: stringField(row, "password"),
          })),
    },
  });
  const guard = new LastWayInGuard({ lastWayIn });
  const requiringOrganizations: RequiringOrganizations = async ({ userId }) => {
    const membership = rows(db, "organizationMember").find(
      (row) => stringField(row, "userId") === userId,
    );
    if (!membership) return [];
    const organization = rows(db, "organization").find(
      (row) =>
        stringField(row, "id") === stringField(membership, "organizationId"),
    );
    return organization?.mfaRequired === true
      ? [{ slug: stringField(organization, "slug") ?? "required" }]
      : [];
  };
  const configuredHooks = requestHooks({
    refuseIfItClosesTheLastDoor: (args) =>
      guard.refuseIfItClosesTheLastDoor(args),
    requiringOrganizations,
    deploymentIsFederationCapable: () => false,
    resolveSignInMethodPolicy: async () => ({
      defaultMethods: [],
      localMethods: [],
      federationLicensed: false,
      selfHosted: false,
    }),
    twoStepCeremonies: () => ({
      afterEnable: async () => {},
      afterVerifyTotp: async () => {},
      afterVerifyBackupCode: async () => {},
      afterGenerateBackupCodes: async () => {},
      afterDisable: async () => {},
    }),
    signInAfterPasswordReset: async () => {},
  });
  const beforeHook = configuredHooks.before;
  if (!beforeHook) {
    throw new Error("the request hook did not configure a before handler");
  }
  const authOptions = {
    baseURL,
    secret: "test-secret-test-secret-test-secret",
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    plugins: [
      passkey({
        rpID: "localhost",
        rpName: "LangWatch test",
        origin: baseURL,
      }),
      twoFactor({ issuer: "LangWatch test", allowPasswordless: true }),
    ],
    hooks: { before: beforeHook },
  };
  const auth = betterAuth(authOptions);
  const setupAuth = betterAuth({ ...authOptions, hooks: void 0 });
  return { auth, setupAuth, db };
}

async function signUpCookie(
  harness: ReturnType<typeof buildHarness>,
): Promise<{ cookie: string; userId: string }> {
  const response = await harness.setupAuth.handler(
    post("/sign-up/email", { email, name: "Last Way User", password }),
  );
  expect(response.status).toBe(200);
  return {
    cookie: responseCookie(response),
    userId: signUpSchema.parse(await response.json()).user.id,
  };
}

async function signIn(
  auth: AuthUnderTest,
): Promise<{ status: number; userId?: string }> {
  const response = await auth.handler(
    post("/sign-in/email", { email, password }),
  );
  if (response.status !== 200) return { status: response.status };
  return {
    status: response.status,
    userId: signInSchema.parse(await response.json()).user.id,
  };
}

async function callRoute({
  auth,
  path,
  cookie,
  body = {},
}: {
  auth: AuthUnderTest;
  path: string;
  cookie?: string;
  body?: Record<string, string>;
}): Promise<Response> {
  const request = post(path, body);
  if (cookie) request.headers.set("cookie", cookie);
  return auth.handler(request);
}

describe("BetterAuth last-way request hooks", () => {
  /** @scenario Removing the last way in is refused */
  it("refuses sole passkey deletion before changing memory rows", async () => {
    const harness = buildHarness();
    const { cookie, userId } = await signUpCookie(harness);
    removeCredentialPassword(harness.db, userId);
    addPasskey(harness.db, userId, "passkey_only");
    const passkeysBefore = structuredClone(rows(harness.db, "passkey"));
    const sessionsBefore = structuredClone(rows(harness.db, "session"));

    const response = await callRoute({
      auth: harness.auth,
      path: "/passkey/delete-passkey",
      cookie,
      body: { id: "passkey_only" },
    });

    expect(response.status).toBe(400);
    expect(refusalSchema.parse(await response.json()).code).toBe("LAST_WAY_IN");
    expect(rows(harness.db, "passkey")).toEqual(passkeysBefore);
    expect(rows(harness.db, "session")).toEqual(sessionsBefore);
  });

  /** @scenario Turning it off is refused while an organization requires it */
  it("refuses required MFA disable before changing user, factor, or session rows", async () => {
    const harness = buildHarness();
    const { cookie, userId } = await signUpCookie(harness);
    harness.db.organization = [
      { id: "org_required", slug: "required", mfaRequired: true },
    ];
    harness.db.organizationMember = [
      { userId, organizationId: "org_required" },
    ];
    harness.db.twoFactor = [
      { id: "factor", userId, secret: "encrypted", verified: true },
    ];
    const user = rows(harness.db, "user").find(
      (row) => stringField(row, "id") === userId,
    );
    if (!user) throw new Error("the signup did not create a user row");
    user.twoFactorEnabled = true;
    const usersBefore = structuredClone(rows(harness.db, "user"));
    const factorsBefore = structuredClone(rows(harness.db, "twoFactor"));
    const sessionsBefore = structuredClone(rows(harness.db, "session"));

    const response = await callRoute({
      auth: harness.auth,
      path: "/two-factor/disable",
      body: { password },
      cookie,
    });

    expect(response.status).toBe(400);
    expect(refusalSchema.parse(await response.json()).code).toBe(
      "MFA_REQUIRED_BY_ORGANIZATION",
    );
    expect(rows(harness.db, "user")).toEqual(usersBefore);
    expect(rows(harness.db, "twoFactor")).toEqual(factorsBefore);
    expect(rows(harness.db, "session")).toEqual(sessionsBefore);
  });

  it("keeps anonymous deletion at the native authentication boundary", async () => {
    const harness = buildHarness();
    const response = await callRoute({
      auth: harness.auth,
      path: "/passkey/delete-passkey",
      body: { id: "missing-passkey" },
    });
    expect(response.status).toBe(401);
    expect(rows(harness.db, "passkey")).toEqual([]);
    expect(rows(harness.db, "session")).toEqual([]);
  });

  it("deletes exactly the requested passkey when a password survives", async () => {
    const harness = buildHarness();
    const { cookie, userId } = await signUpCookie(harness);
    addPasskey(harness.db, userId, "passkey_target");

    const response = await callRoute({
      auth: harness.auth,
      path: "/passkey/delete-passkey",
      cookie,
      body: { id: "passkey_target" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true });
    expect(rows(harness.db, "passkey")).toEqual([]);
    await expect(signIn(harness.auth)).resolves.toEqual({
      status: 200,
      userId,
    });
  });
});
