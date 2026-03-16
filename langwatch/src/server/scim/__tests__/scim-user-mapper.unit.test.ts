import { describe, expect, it } from "vitest";
import { toScimUser, scimError, scimListResponse } from "../scim-user-mapper";
import type { User } from "@prisma/client";

function createUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-123",
    name: "Alice Smith",
    email: "alice@acme.com",
    emailVerified: null,
    password: null,
    image: null,
    pendingSsoSetup: false,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-06-01T00:00:00Z"),
    lastLoginAt: null,
    externalId: "ext-abc",
    scimProvisioned: true,
    deactivatedAt: null,
    ...overrides,
  } as User;
}

describe("toScimUser()", () => {
  describe("given an active user with a two-part name", () => {
    it("produces correct SCIM User resource shape", () => {
      const user = createUser();
      const result = toScimUser({ user });

      expect(result).toEqual({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        id: "user-123",
        externalId: "ext-abc",
        userName: "alice@acme.com",
        name: {
          formatted: "Alice Smith",
          givenName: "Alice",
          familyName: "Smith",
        },
        displayName: "Alice Smith",
        active: true,
        meta: {
          resourceType: "User",
          created: new Date("2025-01-01T00:00:00Z"),
          lastModified: new Date("2025-06-01T00:00:00Z"),
        },
      });
    });
  });

  describe("given a deactivated user", () => {
    it("sets active to false", () => {
      const user = createUser({ deactivatedAt: new Date("2025-03-01") });
      const result = toScimUser({ user });

      expect(result.active).toBe(false);
    });
  });

  describe("given a user with a multi-part name", () => {
    it("splits into givenName and familyName correctly", () => {
      const user = createUser({ name: "Jean Claude Van Damme" });
      const result = toScimUser({ user });

      expect(result.name.givenName).toBe("Jean");
      expect(result.name.familyName).toBe("Claude Van Damme");
    });
  });

  describe("given a user with no name", () => {
    it("handles null name gracefully", () => {
      const user = createUser({ name: null });
      const result = toScimUser({ user });

      expect(result.name.givenName).toBe("");
      expect(result.name.familyName).toBe("");
      expect(result.name.formatted).toBeNull();
    });
  });

  describe("given a user with no externalId", () => {
    it("returns null for externalId", () => {
      const user = createUser({ externalId: null });
      const result = toScimUser({ user });

      expect(result.externalId).toBeNull();
    });
  });
});

describe("scimError()", () => {
  it("produces SCIM error response shape", () => {
    const result = scimError({ status: 404, detail: "Not found" });

    expect(result).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: "Not found",
      status: 404,
    });
  });
});

describe("scimListResponse()", () => {
  it("produces SCIM ListResponse shape", () => {
    const user = createUser();
    const resources = [toScimUser({ user })];

    const result = scimListResponse({
      resources,
      totalResults: 1,
      startIndex: 1,
      itemsPerPage: 1,
    });

    expect(result.schemas).toEqual(["urn:ietf:params:scim:api:messages:2.0:ListResponse"]);
    expect(result.totalResults).toBe(1);
    expect(result.startIndex).toBe(1);
    expect(result.itemsPerPage).toBe(1);
    expect(result.Resources).toHaveLength(1);
  });
});
