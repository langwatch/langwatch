/**
 * @vitest-environment node
 * The account write behind auth's register door (D-A1U-2): it writes the row itself, so it records
 * user's registered fact, from which nurturing derives `signed_up`; a refusal records nothing.
 * @see specs/licensing/sso-license-gating.feature
 */
import { EmailAlreadyRegisteredError } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { MemoryUserDatabase } from "../../repositories/memory/memory.user.database.ts";
import { memoryUserRepositoriesOver } from "../../repositories/memory/memory.user.repositories.ts";
import { createUserTestApp, createUserTestLifecycle } from "./user.fixture.ts";

function register(
  app: ReturnType<typeof createUserTestApp>,
  email = "a@x.com",
  { addressConfirmed = true } = {},
) {
  return app.registerCredentialAccount({
    name: "Alice",
    email,
    password: "supersecret",
    addressConfirmed,
  });
}

describe("registering a credential account", () => {
  describe("when registration succeeds", () => {
    /** @scenario "A self-service registration is recorded as user's fact" */
    it("commits the created fact, then one registered fact, with the new account", async () => {
      const database = MemoryUserDatabase.create();
      const app = createUserTestApp({ repositories: memoryUserRepositoriesOver({ database }) });

      const created = await register(app);

      expect(created).toEqual({ id: expect.any(String) });
      const fact = { tenantId: created.id, userId: created.id, occurredAt: expect.any(Number) };
      expect(database.factOutbox()).toEqual([
        { type: "recordCreated", data: fact },
        {
          type: "recordRegistered",
          data: {
            ...fact,
            accountId: expect.any(String),
            createdAtMs: expect.any(Number),
            email: "a@x.com",
          },
        },
      ]);
    });
  });

  describe("when the event bus is down", () => {
    /** @scenario "A registration stands even when the event bus is down" */
    it("still creates the account and answers it", async () => {
      const { senders } = createUserTestLifecycle();
      const down = {
        send: async () => {
          throw new Error("event bus unavailable");
        },
      };
      const app = createUserTestApp({
        lifecycle: { ...senders, recordUserCreated: down, recordUserRegistered: down },
      });

      const created = await register(app);

      await expect(app.findById({ id: created.id })).resolves.toMatchObject({ email: "a@x.com" });
    });
  });

  describe("when the email is already registered", () => {
    /** @scenario "A refused registration records no registered fact" */
    it("refuses and records no second registered fact", async () => {
      const database = MemoryUserDatabase.create();
      const app = createUserTestApp({ repositories: memoryUserRepositoriesOver({ database }) });

      await register(app);
      const committed = database.factOutbox().length;

      await expect(register(app)).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
      expect(database.factOutbox()).toHaveLength(committed);
    });
  });

  describe("when auth's door spent a confirming proof", () => {
    it("creates the account already confirmed", async () => {
      const app = createUserTestApp();

      const created = await register(app);

      await expect(app.findById({ id: created.id })).resolves.toMatchObject({
        emailVerified: true,
      });
    });
  });

  describe("when auth's door spent an unconfirmed proof, where the installation cannot send email", () => {
    /** @scenario "An installation that cannot send email signs up with a password and leaves the address unconfirmed" */
    it("creates the account with its address unconfirmed", async () => {
      const app = createUserTestApp();

      const created = await register(app, "sam@acme.com", { addressConfirmed: false });

      await expect(app.findById({ id: created.id })).resolves.toMatchObject({
        emailVerified: false,
      });
    });
  });

  describe("when the email is typed with capital letters", () => {
    /**
     * Sign-in lowercases the address on every lookup, so an account stored as
     * typed is one sign-in can never find: the customer is locked out with
     * "already exists" forever.
     * @scenario "A capitalised email creates an account sign-in can find"
     */
    it("stores the lowercased address", async () => {
      const app = createUserTestApp();

      const created = await register(app, "Joel.During@example.com");

      await expect(app.findById({ id: created.id })).resolves.toMatchObject({
        email: "joel.during@example.com",
      });
    });

    /** @scenario "A capitalised email creates an account sign-in can find" */
    it("refuses a second signup for the same address typed differently", async () => {
      const app = createUserTestApp();

      await register(app, "joel.during@example.com");

      await expect(register(app, "Joel.During@example.com")).rejects.toBeInstanceOf(
        EmailAlreadyRegisteredError,
      );
    });
  });
});
