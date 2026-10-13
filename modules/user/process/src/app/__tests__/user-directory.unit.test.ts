/**
 * @vitest-environment node
 * The user application as the API process's user directory.
 * @see specs/server/api-process-auth.feature
 */
import { InMemoryProcessStore } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { MemoryUserRepositories } from "../../repositories/memory/memory.user.repositories.ts";
import { createUserTestApp, TEST_CREDENTIAL_ISSUER } from "./user.fixture.ts";

const ADDRESS = "sam@acme.com";

function directory() {
  const repositories = MemoryUserRepositories.create({
    processStore: InMemoryProcessStore.createForTesting(),
  });
  return { repositories, app: createUserTestApp({ repositories }) };
}

describe("the user application as the process's user directory", () => {
  describe("when a passkey sign-up completes for an address nobody holds", () => {
    /** @scenario "A passkey ceremony mints its account through the process's directory" */
    it("finds no account, mints one and answers its identifier", async () => {
      const { app } = directory();

      expect(await app.findByEmail({ email: ADDRESS })).toBeNull();
      const created = await app.createPasskeyUser({ email: ADDRESS });

      expect(created.id).not.toEqual("");
      expect(await app.findByEmail({ email: ADDRESS })).toMatchObject({ id: created.id });
    });
  });

  describe("when a passkey sign-up starts for an address somebody already holds", () => {
    /** @scenario "A passkey ceremony is refused for an address that already has an account" */
    it("answers the held account, which is what the ceremony refuses on, and mints nothing", async () => {
      const { app, repositories } = directory();
      const held = await repositories.users.createPasskeyUser({
        email: ADDRESS,
        issuer: TEST_CREDENTIAL_ISSUER,
        emailVerified: true,
      });

      expect(await app.findByEmail({ email: ADDRESS })).toMatchObject({ id: held.id });
      expect(await app.findByEmail({ email: ADDRESS.toUpperCase() })).toMatchObject({
        id: held.id,
      });
    });
  });

  describe("when a directory push names somebody the deployment does not know", () => {
    /** @scenario "A directory push mints an account through the process's directory" */
    it("looks the address up, then creates the account", async () => {
      const { app } = directory();

      expect(await app.findByEmail({ email: ADDRESS })).toBeNull();
      const profile = await app.create({ name: "Sam", email: ADDRESS });

      expect(await app.findByEmail({ email: ADDRESS })).toMatchObject({ id: profile.id });
    });
  });
});
