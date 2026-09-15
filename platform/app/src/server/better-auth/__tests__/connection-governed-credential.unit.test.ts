import type { SignInMethodPolicy } from "@langwatch/identity";
import { describe, expect, it, vi } from "vitest";
import { requestHooks } from "../config/request-hooks";

/**
 * The credential boundary, over an address an organization routes through its
 * own identity provider.
 *
 * A deployment that issues its own passwords (D09) opens `/sign-in/email` and
 * the reset pair for the DEPLOYMENT. It must not open them for somebody whose
 * company has said its people sign in one way — that company's connection is
 * where session lifetime, conditional access and revocation live, and a local
 * password beside it answers none of them.
 */

const PASSWORD = {
  id: "password",
  kind: "password" as const,
  connectionId: null,
};
const PASSKEY = { id: "passkey", kind: "passkey" as const, connectionId: null };
const BROKER = { id: "auth0", kind: "federated" as const, connectionId: null };

/** What `resolveSignInMethodPolicy` answers with the switch on. */
const issuesOwnPasswords: SignInMethodPolicy = {
  defaultMethods: [BROKER, PASSWORD, PASSKEY],
  localMethods: [PASSWORD],
  federationLicensed: true,
  selfHosted: false,
};

/** The same deployment before the switch: no password on the rail. */
const brokerOnly: SignInMethodPolicy = {
  ...issuesOwnPasswords,
  defaultMethods: [BROKER, PASSKEY],
};

function hookOver({
  policy,
  routesToConnection,
}: {
  policy: SignInMethodPolicy;
  routesToConnection: (args: { email: string }) => Promise<boolean>;
}) {
  const hooks = requestHooks({
    refuseIfItClosesTheLastDoor: async () => {},
    requiringOrganizations: async () => [],
    deploymentIsFederationCapable: () => true,
    resolveSignInMethodPolicy: async () => policy,
    twoStepCeremonies: () => ({
      afterEnable: async () => {},
      afterVerifyTotp: async () => {},
      afterVerifyBackupCode: async () => {},
      afterGenerateBackupCodes: async () => {},
      afterDisable: async () => {},
    }),
    signInAfterPasswordReset: async () => {},
    addressRoutesToConnection: routesToConnection,
  });
  const before = hooks?.before;
  if (!before) throw new Error("no before hook was configured");
  return before;
}

async function submit({
  policy,
  routesToConnection,
  path = "/api/auth/sign-in/email",
  body = { email: "sam@acme.com", password: "correct horse" },
}: {
  policy: SignInMethodPolicy;
  routesToConnection: (args: { email: string }) => Promise<boolean>;
  path?: string;
  body?: unknown;
}): Promise<{ refused: boolean }> {
  const before = hookOver({ policy, routesToConnection });
  try {
    await (before as (ctx: unknown) => Promise<unknown>)({
      request: new Request(`https://app.langwatch.test${path}`),
      path: path.replace("/api/auth", ""),
      body,
    });
    return { refused: false };
  } catch {
    return { refused: true };
  }
}

describe("the credential boundary on a deployment that issues its own passwords", () => {
  describe("given an address an organization routes through its own provider", () => {
    /** @scenario "An organization's own connection still refuses a local password" */
    it("refuses a credential sign-in for it", async () => {
      const routesToConnection = vi.fn().mockResolvedValue(true);

      await expect(
        submit({ policy: issuesOwnPasswords, routesToConnection }),
      ).resolves.toEqual({ refused: true });
      expect(routesToConnection).toHaveBeenCalledWith({
        email: "sam@acme.com",
      });
    });

    /** @scenario "An organization's own connection still refuses a local password" */
    it("refuses a password reset for it too", async () => {
      // Reset is the other half of the same door: recovering a password for a
      // connection-governed address would mint the way in the connection
      // exists to prevent, one email later.
      await expect(
        submit({
          policy: issuesOwnPasswords,
          routesToConnection: async () => true,
          path: "/api/auth/request-password-reset",
          body: { email: "sam@acme.com" },
        }),
      ).resolves.toEqual({ refused: true });
    });
  });

  describe("given an ordinary address", () => {
    /** @scenario "An organization's own connection still refuses a local password" */
    it("lets the credential sign-in through", async () => {
      await expect(
        submit({
          policy: issuesOwnPasswords,
          routesToConnection: async () => false,
        }),
      ).resolves.toEqual({ refused: false });
    });
  });

  describe("given a deployment that does not issue its own passwords", () => {
    it("never pays the connection lookup, because the policy already refused", async () => {
      const routesToConnection = vi.fn().mockResolvedValue(false);

      const outcome = await submit({
        policy: brokerOnly,
        routesToConnection,
      });

      // The deployment-wide refusal answered first, so nothing reached the
      // organization question — which is what keeps this off the hot path of
      // every deployment that has not turned the switch on.
      expect(outcome).toEqual({ refused: true });
      expect(routesToConnection).not.toHaveBeenCalled();
    });
  });

  describe("given a request that names no address", () => {
    it("asks nothing and refuses nothing on that ground", async () => {
      // Both halves, because the refusal is the half that matters: a lookup
      // that answers "governed" for every address must not turn an
      // address-less request into a refusal, or `/reset-password` — which
      // carries a token and no email — would stop working the moment any
      // connection existed.
      const routesToConnection = vi.fn().mockResolvedValue(true);

      await expect(
        submit({
          policy: issuesOwnPasswords,
          routesToConnection,
          body: {},
        }),
      ).resolves.toEqual({ refused: false });

      expect(routesToConnection).not.toHaveBeenCalled();
    });
  });
});
