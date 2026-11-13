import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { roleCreateSchema, roleSchema, roleUpdateSchema } from "../index.ts";
import {
  ROLE_PERMISSION_ACTIONS,
  ROLE_PERMISSION_RESOURCES,
  rolePermissionKeySchema,
} from "../role-rest.schemas.ts";
import { roleApiCreateInputSchema } from "../role.schemas.ts";

describe("role contract", () => {
  it("accepts the wire-safe custom role value", () => {
    const role = roleSchema.parse({
      id: "role_1",
      organizationId: "org_1",
      name: "Reviewer",
      description: null,
      permissions: ["traces:view"],
      kind: "custom",
      createdAt: new Date(1),
      updatedAt: new Date(1),
    });
    expect(role.kind).toBe("custom");
  });

  it("rejects unknown fields and reserved role input is left to the service", () => {
    expect(() =>
      roleCreateSchema.parse({
        organizationId: "org_1",
        name: "Reviewer",
        permissions: ["traces:view"],
        extra: true,
      }),
    ).toThrow(ZodError);
    expect(roleUpdateSchema.parse({ description: null })).toEqual({ description: null });
  });

  /** @scenario "No role, custom role or API key may list the braid permission" */
  it("refuses the braid permission, minted at proof time and never granted", () => {
    expect(rolePermissionKeySchema.validate("spans:braided")).toBe(false);
    expect(ROLE_PERMISSION_RESOURCES).not.toContain("spans");
    expect(ROLE_PERMISSION_ACTIONS).not.toContain("braided");
    expect(
      roleApiCreateInputSchema.validate({
        organizationId: "org_1",
        name: "Braided",
        permissions: ["traces:view", "spans:braided"],
      }),
    ).toBe(false);
  });
});
