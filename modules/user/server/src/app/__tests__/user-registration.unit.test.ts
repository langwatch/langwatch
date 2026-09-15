/**
 * @vitest-environment node
 * The signup form's own choke point: it writes the account row itself, so it
 * owns the `signed_up` milestone - and a rejected registration tracks nothing.
 * @see specs/licensing/sso-license-gating.feature
 */
import { EmailAlreadyRegisteredError, UserRegistrationNotAvailableError } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { createUserTestApp, createUserTestInfrastructure } from "./user.fixture.ts";

function register(app: ReturnType<typeof createUserTestApp>, email = "a@x.com") {
  return app.registerCredentialAccount({
    name: "Alice",
    email,
    password: "supersecret",
    callerAddress: "127.0.0.1",
  });
}

describe("registering a credential account", () => {
  describe("when registration succeeds", () => {
    /** @scenario Email-mode registration tracks the PostHog signed_up milestone exactly once */
    it("tracks the signed_up analytics event with the new account id", async () => {
      const members = createUserTestInfrastructure();
      const app = createUserTestApp({ members });

      const created = await register(app);

      expect(created.id).toEqual(expect.any(String));
      expect(members.analytics.trackServerEvent).toHaveBeenCalledTimes(1);
      expect(members.analytics.trackServerEvent).toHaveBeenCalledWith({
        userId: created.id,
        event: "signed_up",
      });
    });
  });

  describe("when the email is already registered", () => {
    /** @scenario A rejected registration tracks no PostHog signed_up milestone */
    it("refuses and tracks no signed_up analytics event", async () => {
      const members = createUserTestInfrastructure();
      const app = createUserTestApp({ members });

      await register(app);
      vi.mocked(members.analytics.trackServerEvent).mockClear();

      await expect(register(app)).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
      expect(members.analytics.trackServerEvent).not.toHaveBeenCalled();
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

      await expect(app.tryFindById({ id: created.id })).resolves.toMatchObject({
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

  describe("given an SSO-capable deployment where the gate denies (coerced email mode)", () => {
    /** @scenario "A fresh unlicensed deployment bootstraps via email signup" */
    it("registers the account through the signup form's own path", async () => {
      const app = createUserTestApp({
        members: {
          deployment: {
            authProvider: vi.fn(async () => "email"),
            offersPasskeys: () => false,
            findBaseUrl: () => null,
          },
        },
      });

      await expect(register(app, "operator@example.com")).resolves.toMatchObject({
        id: expect.any(String),
      });
    });
  });

  describe("given an SSO-capable deployment where the gate allows", () => {
    /** @scenario "A licensed deployment cannot mint password accounts" */
    it("refuses direct registration", async () => {
      const app = createUserTestApp({
        members: {
          deployment: {
            authProvider: vi.fn(async () => "auth0"),
            offersPasskeys: () => false,
            findBaseUrl: () => null,
          },
        },
      });

      await expect(register(app, "operator@example.com")).rejects.toBeInstanceOf(
        UserRegistrationNotAvailableError,
      );
    });
  });
});
