import { describe, expect, it } from "vitest";
import {
  scimCreateGroupRequestSchema,
  scimCreateUserRequestSchema,
} from "../scim.types";

/**
 * What a provisioning client that has no external identifier actually sends.
 *
 * It sends the key, empty — the simulator did, and real ones do. The schema
 * asked for `.min(1)` when the field was present, so an empty string refused
 * the WHOLE resource with a 400 carrying a Zod sentence, over a field RFC
 * 7644 makes optional. This executes the parse rather than asserting the
 * schema's shape back at itself: the bug was a rejected push, so the test has
 * to be a push that is not rejected.
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
      // Read as absent, never stored as a blank id pretending to be one.
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
