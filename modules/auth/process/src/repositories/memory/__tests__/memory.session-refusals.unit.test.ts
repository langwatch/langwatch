import type { SsoMigrationCallbackApi } from "@langwatch/identity-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
/**
 * The session-create refusals and the hidden sign-up flag, on the memory tier: Better Auth's
 * memory adapter and the hooks' memory twin share one database. The hook itself is unit-tested
 * over a double in transport/__tests__/deactivated-sign-in.unit.test.ts.
 */
import { hash } from "bcrypt";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";

import { providerAccountIssuer } from "../../../rules/provider-account-issuer.rules.ts";
import { betterAuthTransportFor } from "../../../transport/__tests__/better-auth-transport.test-helpers.ts";
import { MemoryAuthDatabase, type MemoryUserRow } from "../memory.auth.database.ts";
import { MemoryBetterAuthHooksRepository } from "../memory.better-auth-hooks.repository.ts";

const BASE = "https://app.langwatch.test";
const PERSON = { email: "dana@company.test", password: "correct-horse-battery", name: "Dana" };

/** This transport serves sign-up through auth's own route, so the person is seeded as it leaves. */
async function memoryTier() {
  const memory = MemoryAuthDatabase.create();
  const at = new Date();
  memory.db.User.push({
    id: "user_dana",
    email: PERSON.email,
    name: PERSON.name,
    emailVerified: true,
    pendingSsoSetup: false,
    signupConfirmationPending: false,
    deactivatedAt: null,
    createdAt: at,
    updatedAt: at,
  });
  memory.db.Account.push({
    id: "account_dana",
    userId: "user_dana",
    provider: "credential",
    providerAccountId: "user_dana",
    issuer: providerAccountIssuer({ connectionIssuer: undefined, provider: "credential" }),
    password: await hash(PERSON.password, 4),
    createdAt: at,
    updatedAt: at,
  });
  const transport = betterAuthTransportFor(
    {},
    {
      storage: { adapter: () => memoryAdapter(memory.db) } as never,
      database: MemoryBetterAuthHooksRepository.create({ memory }),
      ssoMigration: createApiFixture<SsoMigrationCallbackApi>({
        decideAccountLink: async () => ({ kind: "not_migrating" }),
        authorizeAndRecordAuthentication: async () => ({ action: "continue" }),
      }),
    },
  );
  const call = (path: string, init: { body?: unknown; cookie?: string } = {}) =>
    transport.handler(
      new Request(`${BASE}/api/auth${path}`, {
        method: init.body === undefined ? "GET" : "POST",
        headers: {
          "content-type": "application/json",
          origin: BASE,
          ...(init.cookie ? { cookie: init.cookie } : {}),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    );
  const person = () => {
    const row = (memory.db.User as MemoryUserRow[]).find((user) => user.email === PERSON.email);
    if (!row) throw new Error("the sign-up wrote no user row");
    return row;
  };
  const signIn = () =>
    call("/sign-in/email", { body: { email: PERSON.email, password: PERSON.password } });
  return { memory, call, person, signIn };
}

function sessionCookie(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

describe("the memory tier's session create", () => {
  describe("given a person whose sign-up is confirmed", () => {
    /** @scenario "The hidden sign-up confirmation flag stays out of the session payload" */
    it("mints a session whose get-session payload carries no signupConfirmationPending", async () => {
      const tier = await memoryTier();

      const signedIn = await tier.signIn();
      expect(signedIn.status).toBe(200);
      const session = await tier.call("/get-session", { cookie: sessionCookie(signedIn) });
      const body = (await session.json()) as { user: Record<string, unknown> };

      expect(body.user.email).toBe(PERSON.email);
      expect(body.user).not.toHaveProperty("signupConfirmationPending");
      expect(tier.person().signupConfirmationPending).toBe(false);
    });
  });

  describe("given a deactivated person", () => {
    /** @scenario "The memory tier refuses a session to a deactivated person" */
    it("refuses the session", async () => {
      const tier = await memoryTier();
      tier.person().deactivatedAt = new Date();

      const signedIn = await tier.signIn();

      expect(signedIn.ok).toBe(false);
      expect(tier.memory.db.Session).toHaveLength(0);
    });
  });

  describe("given a person whose sign-up confirmation is pending", () => {
    /** @scenario "The memory tier refuses a session while sign-up confirmation is pending" */
    it("refuses the session", async () => {
      const tier = await memoryTier();
      tier.person().signupConfirmationPending = true;

      const signedIn = await tier.signIn();

      expect(signedIn.ok).toBe(false);
      expect(tier.memory.db.Session).toHaveLength(0);
    });
  });
});
