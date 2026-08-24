/**
 * @vitest-environment node
 *
 * @see specs/api-reference/scim-api-reference.feature
 *
 * SCIM Groups provision LangWatch access groups (the Group model), not
 * Teams. The /Schemas discovery copy is what an IdP administrator reads
 * when wiring provisioning, so it must name the right resource.
 */
import { app } from "~/server/enterprise/scim/routes";
import { describe, expect, it } from "vitest";

describe("Feature: SCIM API reference", () => {
  describe("when an identity provider requests GET /api/scim/v2/Schemas", () => {
    /** @scenario The SCIM schema describes groups as access groups */
    it("describes the Group resource as a LangWatch access group", async () => {
      const res = await app.request("/api/scim/v2/Schemas");
      expect(res.status).toBe(200);

      const body = await res.json();
      const groupSchema = body.Resources.find(
        (resource: { id: string }) =>
          resource.id === "urn:ietf:params:scim:schemas:core:2.0:Group",
      );

      expect(groupSchema).toBeDefined();
      expect(groupSchema.description).toBe(
        "Group (maps to a LangWatch access group)",
      );
      expect(groupSchema.description).not.toContain("Team");
    });
  });
});
