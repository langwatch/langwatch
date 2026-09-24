import type { SignInMethodPolicy } from "@langwatch/identity";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { symmetricDecrypt } from "better-auth/crypto";
import { twoFactor } from "better-auth/plugins/two-factor";
import { z } from "zod";
import { databaseHooks } from "../../config/database-hooks";
import { requestHooks } from "../../config/request-hooks";
import {
  CredentialSessionGuard,
  type CredentialSignInPolicy,
} from "../../credential-session-guard";
import { createSessionGateHooks } from "./session-gate";

const baseURL = "http://localhost:3000";
export const credentialEmail = "owner@company.test";
export const credentialPassword = "test-password-1";
const identitySchema = z.object({ user: z.object({ id: z.string() }) });
const enrollmentSchema = z.object({
  totpURI: z.string(),
  backupCodes: z.array(z.string()),
});

export function credentialRequest(
  path: string,
  body: Record<string, unknown>,
  cookie?: string,
): Request {
  return new Request(`${baseURL}/api/auth${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

export function responseCookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

interface CredentialSeedInput {
  email?: string;
  mfa?: boolean;
}

export function credentialHandler({
  canSignIn,
  federationCapable = false,
  governingAddress = credentialEmail,
  verifiedAlias,
}: {
  canSignIn: CredentialSignInPolicy["canSignIn"];
  federationCapable?: boolean;
  governingAddress?: string;
  verifiedAlias?: { email: string; canonicalEmail: string };
}) {
  const db: Record<string, Record<string, unknown>[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
    twoFactor: [],
  };
  const guard = new CredentialSessionGuard({ canSignIn });
  const hooks = createSessionGateHooks({
    findUser: async () => ({
      deactivatedAt: null,
      signupConfirmationPending: false,
    }),
  });
  const policy: SignInMethodPolicy = {
    defaultMethods: [{ id: "password", kind: "password", connectionId: null }],
    localMethods: [{ id: "password", kind: "password", connectionId: null }],
    federationLicensed: true,
    selfHosted: true,
  };
  const configuredHooks = databaseHooks({
    hooks: () => hooks,
    credentialSessions: () => guard,
    userErasure: () => ({ beforeUserDelete: async () => {} }),
    accountCeremonies: () => ({
      beforeAccountCreate: async () => void 0,
      beforeAccountDelete: async () => {},
    }),
    sessionClaims: () => ({
      claimsForMint: async () => ({ identifierId: null, amr: [] }),
    }),
    providerAssertions: () => ({
      recordVerifiedCallbackToken: () => {},
      recordAuthenticatedCallbackAccount: () => {},
    }),
  });
  const database: ReturnType<typeof memoryAdapter> = (options) => {
    const adapter = memoryAdapter(db)(options);
    return {
      ...adapter,
      findOne: (args) =>
        adapter.findOne({
          ...args,
          where: args.where?.map((clause) =>
            args.model === "user" &&
            clause.field === "email" &&
            verifiedAlias &&
            clause.value === verifiedAlias.email
              ? { ...clause, value: verifiedAlias.canonicalEmail }
              : clause,
          ),
        }),
    };
  };
  const options = {
    baseURL,
    secret: "test-secret-test-secret-test-secret",
    database,
    emailAndPassword: { enabled: true },
    plugins: [twoFactor({ issuer: "credential-handler-test" })],
  };
  const auth = betterAuth({
    ...options,
    databaseHooks: configuredHooks,
    hooks: requestHooks({
      refuseIfItClosesTheLastDoor: async () => {},
      requiringOrganizations: async () => [],
      deploymentIsFederationCapable: () => federationCapable,
      resolveSignInMethodPolicy: async () => policy,
      twoStepCeremonies: () => ({
        afterEnable: async () => {},
        afterVerifyTotp: async () => {},
        afterVerifyBackupCode: async () => {},
        afterGenerateBackupCodes: async () => {},
        afterDisable: async () => {},
      }),
      signInAfterPasswordReset: async () => {},
      addressRoutesToConnection: async ({ email }) =>
        email === governingAddress,
      signInLockout: () => ({
        refuseIfLockedOut: async () => {},
        recordFailure: async () => {},
        recordSuccess: async () => {},
      }),
    }),
  });
  const setupAuth = betterAuth(options);
  const seed = async ({
    email = credentialEmail,
    mfa = false,
  }: CredentialSeedInput = {}) => {
    const signup = await setupAuth.handler(
      credentialRequest("/sign-up/email", {
        email,
        password: credentialPassword,
        name: "Recovery holder",
      }),
    );
    if (signup.status !== 200)
      throw new Error(`signup failed: ${await signup.text()}`);
    const userId = identitySchema.parse(await signup.json()).user.id;
    let totpSecret = "";
    let backupCodes: string[] = [];
    if (mfa) {
      const enable = await auth.handler(
        credentialRequest(
          "/two-factor/enable",
          { password: credentialPassword },
          responseCookies(signup),
        ),
      );
      if (enable.status !== 200)
        throw new Error(`enrollment failed: ${await enable.text()}`);
      const enrolled = enrollmentSchema.parse(await enable.json());
      const factor = z
        .object({ secret: z.string() })
        .parse(db.twoFactor?.find((row) => row.userId === userId));
      totpSecret = await symmetricDecrypt({
        key: options.secret,
        data: factor.secret,
      });
      backupCodes = enrolled.backupCodes;
      const { code } = await auth.api.generateTOTP({
        body: { secret: totpSecret },
      });
      const verified = await auth.handler(
        credentialRequest(
          "/two-factor/verify-totp",
          { code },
          responseCookies(signup),
        ),
      );
      if (verified.status !== 200)
        throw new Error(
          `enrollment verification failed: ${await verified.text()}`,
        );
    }
    db.session = [];
    return { userId, totpSecret, backupCodes };
  };
  const signIn = (email = credentialEmail, password = credentialPassword) =>
    auth.handler(credentialRequest("/sign-in/email", { email, password }));
  return { auth, db, seed, signIn };
}
