/**
 * @see specs/identity/signin-signup-screens.feature
 */
import { createErrorHandler } from "@langwatch/api";
import { IdentityVerificationExpiredError } from "@langwatch/identity-contract";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { releaseHandledRefusal } from "../http.better-auth.channel.ts";
import {
  signUpConfirmationPlugin,
  type SignUpAddressConfirmation,
} from "../http.sign-up-confirmation.channel.ts";

const ORIGIN = "http://localhost:3000";
const HOLDER = { email: "sam@acme.com", password: "correct-horse-battery", name: "Sam" };

type Confirmed = Awaited<ReturnType<SignUpAddressConfirmation["completeVerification"]>>;

const SIGNED_UP = z.object({ user: z.object({ id: z.string() }) });

const profileOf = ({ id, email }: { id: string; email: string }) => ({
  id,
  email,
  name: null,
  emailVerified: false,
  image: null,
  pendingSsoSetup: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastLoginAt: null,
  deactivatedAt: null,
});

function harness(answer: (token: string) => Confirmed) {
  const verification: SignUpAddressConfirmation = {
    completeVerification: async ({ token }) => answer(token),
  };
  const users = new Map<string, string>();
  const auth = betterAuth({
    baseURL: ORIGIN,
    secret: "test-secret-test-secret-test-secret",
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    emailAndPassword: { enabled: true },
    onAPIError: { onError: releaseHandledRefusal },
    plugins: [
      signUpConfirmationPlugin({
        verification,
        users: {
          findByEmail: async ({ email }) => {
            const id = users.get(email);
            return id ? profileOf({ id, email }) : null;
          },
        },
      }),
    ],
  });
  const host = new Hono();
  host.onError(createErrorHandler());
  host.all("/api/auth/*", (context) => auth.handler(context.req.raw));

  const post = (path: string, body: unknown) =>
    host.fetch(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify(body),
      }),
    );

  return {
    post,
    async registered() {
      const response = await post("/sign-up/email", HOLDER);
      const { user } = SIGNED_UP.parse(await response.json());
      users.set(HOLDER.email, user.id);
    },
  };
}

const confirmed = (overrides: Partial<Confirmed>): Confirmed => ({
  email: HOLDER.email,
  accountCreated: false,
  accountExists: false,
  addressProof: null,
  freshClaim: true,
  ...overrides,
});

describe("POST /api/auth/sign-up/confirm-address", () => {
  describe("when the link proves an address with no account", () => {
    it("answers the address and its proof, and opens no session", async () => {
      const { post } = harness(() => confirmed({ addressProof: "proof-1" }));

      const response = await post("/sign-up/confirm-address", { token: "tok" });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        email: HOLDER.email,
        accountCreated: false,
        accountExists: false,
        addressProof: "proof-1",
        signedIn: false,
      });
      expect(response.headers.get("set-cookie")).toBeNull();
    });
  });

  describe("when the same link is opened again inside its grace", () => {
    /** @scenario "Opening a confirmation link a second time confirms, rather than refusing" */
    it("confirms the address again and mints no session or cookie", async () => {
      const { post, registered } = harness(() =>
        confirmed({ accountExists: true, freshClaim: false }),
      );
      await registered();

      const response = await post("/sign-up/confirm-address", { token: "tok" });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ accountExists: true, signedIn: false });
      expect(response.headers.get("set-cookie")).toBeNull();
    });
  });

  describe("when the link it spent confirms an account that exists", () => {
    it("opens that account's session and says so", async () => {
      const { post, registered } = harness(() => confirmed({ accountExists: true }));
      await registered();

      const response = await post("/sign-up/confirm-address", { token: "tok" });

      expect(await response.json()).toMatchObject({ signedIn: true });
      expect(response.headers.get("set-cookie")).toContain("better-auth.session_token");
    });
  });

  describe("when the link is dead", () => {
    /** @scenario "A link nobody ever issued is refused the way an expired one is" */
    it("refuses it by the expired code", async () => {
      const { post } = harness(() => {
        throw new IdentityVerificationExpiredError();
      });

      const response = await post("/sign-up/confirm-address", { token: "never-issued" });

      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({ code: "identity_verification_expired" });
    });
  });

  describe("when no token is posted", () => {
    it("refuses the body before spending anything", async () => {
      let asked = false;
      const { post } = harness(() => {
        asked = true;
        return confirmed({});
      });

      const response = await post("/sign-up/confirm-address", { token: "" });

      expect(response.status).toBe(400);
      expect(asked).toBe(false);
    });
  });
});
