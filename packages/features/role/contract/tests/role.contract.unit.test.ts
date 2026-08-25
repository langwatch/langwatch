import { describe, expect, it } from "vitest";
import { roleCreateSchema, roleSchema, roleUpdateSchema } from "../src";

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
    expect(() => roleCreateSchema.parse({ organizationId: "org_1", name: "Reviewer", permissions: ["traces:view"], extra: true })).toThrow();
    expect(roleUpdateSchema.parse({ description: null })).toEqual({ description: null });
  });
});
