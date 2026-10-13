/**
 * @vitest-environment node
 * Every write of an account's address stores it trimmed and lower-cased, so a plain lookup on
 * the lower-cased input finds the account however the address was typed.
 * @see modules/user/specs/user.feature
 */
import { describe, expect, it } from "vitest";

import { createUserTestApp } from "./user.fixture.ts";

describe("an account's stored address", () => {
  describe("when accounts are minted, or an address changed, with capitals and spaces", () => {
    /** @scenario "Stored addresses are lower-cased" */
    it("stores each address trimmed and lower-cased", async () => {
      const app = createUserTestApp();

      const directory = await app.create({ name: "Dir", email: " Dir@Example.COM " });
      const credential = await app.registerCredentialAccount({
        name: "Cred",
        email: "Cred@Example.com",
        password: "first",
        addressConfirmed: false,
      });
      const passkey = await app.createPasskeyUser({ email: "KEY@example.com" });
      const changed = await app.create({ name: "Moved", email: "moved@example.com" });
      await app.updateEmail({ id: changed.id, email: "Moved@Elsewhere.com" });

      const stored = await app.getProfiles({
        userIds: [directory.id, credential.id, passkey.id, changed.id],
      });
      expect(stored.map(({ email }) => email ?? "").toSorted((a, b) => a.localeCompare(b))).toEqual(
        ["cred@example.com", "dir@example.com", "key@example.com", "moved@elsewhere.com"],
      );
    });
  });

  describe("when an account is looked up by its address typed with capitals", () => {
    /** @scenario "A mixed-case sign-in still finds the account" */
    it("answers that account, and counts the address taken", async () => {
      const app = createUserTestApp();
      const created = await app.create({ name: "Ada", email: "ada@example.com" });

      await expect(app.findByEmail({ email: "ADA@Example.com" })).resolves.toMatchObject({
        id: created.id,
      });
      await expect(
        app.registerCredentialAccount({
          name: "Ada",
          email: "Ada@EXAMPLE.com",
          password: "first",
          addressConfirmed: false,
        }),
      ).rejects.toMatchObject({ code: "email_already_registered" });
    });
  });
});
