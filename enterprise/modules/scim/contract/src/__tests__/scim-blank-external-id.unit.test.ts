// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

import { scimCreateGroupRequestSchema, scimCreateUserRequestSchema } from "../scim.contract.ts";

/**
 * A provisioning client with no external identifier sends the key empty about
 * as often as it omits it. This executes the parse rather than asserting the
 * schema's shape back at itself: the bug was a rejected push.
 */
const USER = {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
  userName: "member@acme1.test",
  emails: [{ value: "member@acme1.test", primary: true }],
  active: true,
};

describe("given a directory push carrying an external identifier", () => {
  describe("when the field is sent empty", () => {
    /** @scenario "A blank external identifier is read as none rather than refused" */
    it("accepts the person and reads the identifier as none", () => {
      const parsed = scimCreateUserRequestSchema.safeParse({
        ...USER,
        externalId: "",
      });

      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.externalId).toBeUndefined();
    });

    /** @scenario "A blank external identifier is read as none rather than refused" */
    it("accepts a group the same way", () => {
      const parsed = scimCreateGroupRequestSchema.safeParse({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        displayName: "Engineering",
        externalId: "",
      });

      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.externalId).toBeUndefined();
    });
  });

  describe("when the field carries a real identifier", () => {
    it("keeps it", () => {
      const parsed = scimCreateUserRequestSchema.safeParse({
        ...USER,
        externalId: "okta-00u1",
      });

      expect(parsed.success && parsed.data.externalId).toBe("okta-00u1");
    });
  });

  describe("when the field is omitted", () => {
    it("accepts the person with none", () => {
      const parsed = scimCreateUserRequestSchema.safeParse(USER);

      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.externalId).toBeUndefined();
    });
  });
});
