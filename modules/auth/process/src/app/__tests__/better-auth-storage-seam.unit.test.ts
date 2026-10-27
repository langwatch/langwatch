/**
 * Better Auth's storage, built by auth's repository registry on the memory tier: a real
 * sign-up and sign-in against the memoryAdapter's own rows, and the Map session cache.
 * @see modules/auth/specs/better-auth-storage-seam.feature
 */
import { instantiateRepositories } from "@langwatch/process";
import { beforeEach, describe, expect, it } from "vitest";

import { authRepositories } from "../../repositories/auth-repositories.registry.ts";
import { composedAuth, sessionCookie } from "./support/seam-auth-app.ts";

const PERSON = { email: "dana@company.test", password: "correct-horse-battery", name: "Dana" };

/** Auth composed over the memory tier its registry builds, with no database and no Redis. */
async function memoryTier() {
  const repositories = instantiateRepositories(authRepositories, { tier: "memory", members: {} });
  const { transport, call } = await composedAuth({ repositories });
  // Better Auth's own sign-up, server-side: its HTTP route stays sealed for auth.register.
  const signUp = async () => {
    const created = await transport.api.signUpEmail({ body: PERSON });
    return created.user.id;
  };
  const signIn = (password: string) =>
    call("/sign-in/email", { body: { email: PERSON.email, password } });
  return { repositories, call, signUp, signIn };
}

describe("Better Auth's storage on the memory tier", () => {
  describe("when a user signs up and then signs in with email and password", () => {
    let tier: Awaited<ReturnType<typeof memoryTier>>;
    let userId: string;
    let signedIn: Response;

    beforeEach(async () => {
      tier = await memoryTier();
      userId = await tier.signUp();
      signedIn = await tier.signIn(PERSON.password);
    });

    /** @scenario "The memory tier signs in without a database" */
    it("issues a session that reads back that user", async () => {
      expect(signedIn.status).toBe(200);
      const session = await tier.call("/get-session", { cookie: sessionCookie(signedIn) });
      const body = (await session.json()) as { user: { id: string; email: string } };

      expect(body.user).toMatchObject({ id: userId, email: PERSON.email });
      expect(await tier.repositories.sessions.findTokensForUser({ userId })).not.toHaveLength(0);
    });

    /** @scenario "The session cache lives in the registry's secondary storage" */
    it("caches the session in the memory secondary storage the registry built", async () => {
      const { token } = (await signedIn.json()) as { token: string };
      const cached = await tier.repositories.betterAuthSecondaryStorage.get(token);

      expect(cached).not.toBeNull();
      expect(JSON.parse(String(cached))).toMatchObject({ user: { id: userId } });
    });
  });

  describe("when someone signs in as a signed-up user with a different password", () => {
    /** @scenario "A wrong password on the memory tier is refused, not thrown" */
    it("refuses the sign-in as invalid credentials and issues no session", async () => {
      const tier = await memoryTier();
      const userId = await tier.signUp();
      const sessionsAtSignUp = await tier.repositories.sessions.findTokensForUser({ userId });
      const cachedAtSignUp = await tier.repositories.betterAuthSecondaryStorage.get(
        `active-sessions-${userId}`,
      );

      const refused = await tier.signIn("a-different-password");

      expect(refused.ok).toBe(false);
      expect(await refused.json()).toMatchObject({ code: "identity_sign_in_refused" });
      expect(sessionCookie(refused)).not.toContain("session_token");
      expect(await tier.repositories.sessions.findTokensForUser({ userId })).toEqual(
        sessionsAtSignUp,
      );
      expect(
        await tier.repositories.betterAuthSecondaryStorage.get(`active-sessions-${userId}`),
      ).toEqual(cachedAtSignUp);
    });
  });
});
