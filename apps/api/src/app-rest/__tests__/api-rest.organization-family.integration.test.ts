/**
 * The organization profile over REST: the organization is implied by the credential,
 * reads return what writes accept, and the fields this API does not own — the single
 * @see specs/organizations/organization-rest-api.feature
 */
import { MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import { describe, expect, it } from "vitest";

import {
  ORGANIZATION_BASE,
  ORGANIZATION_BEARER,
  organizationWorld,
} from "./support/organization-family.world";
import { errorCodeOf, TEST_ORGANIZATION_ID } from "./support/rest-family.harness";

describe("given an organization-scoped credential on an Enterprise plan", () => {
  describe("when the organization is fetched", () => {
    // @scenario "Fetching the organization returns the caller's organization"
    it("returns the credential's own organization with its profile settings", async () => {
      const world = organizationWorld();

      const response = await world.api.get(`${ORGANIZATION_BASE}/`, ORGANIZATION_BEARER);

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        id: TEST_ORGANIZATION_ID,
        name: "Acme",
        slug: "acme",
        supportContact: "support@acme.test",
        presenceEnabled: true,
        traceSharingEnabled: true,
      });
    });
  });

  describe("when the organization is renamed", () => {
    // @scenario "Renaming the organization takes effect"
    it("applies the new name and reads it back", async () => {
      const world = organizationWorld();

      const response = await world.api.patch(
        `${ORGANIZATION_BASE}/`,
        { name: "Acme Platform" },
        ORGANIZATION_BEARER,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ name: "Acme Platform" });

      const readBack = await world.api.get(`${ORGANIZATION_BASE}/`, ORGANIZATION_BEARER);
      await expect(readBack.json()).resolves.toMatchObject({ name: "Acme Platform" });
    });
  });

  describe("when the rename carries an empty name", () => {
    // @scenario "An empty organization name is refused"
    it("refuses with validation_error and leaves the name unchanged", async () => {
      const world = organizationWorld();

      const response = await world.api.patch(
        `${ORGANIZATION_BASE}/`,
        { name: "" },
        ORGANIZATION_BEARER,
      );

      expect(response.status).toBe(422);
      await expect(errorCodeOf(response)).resolves.toBe("validation_error");
      expect(world.organization().name).toBe("Acme");
    });
  });

  describe("when the organization has a single sign-on domain and provider configured", () => {
    // @scenario "Single sign-on fields are not exposed"
    it("reports neither field, and an update naming them changes neither", async () => {
      const world = organizationWorld({
        sso: { ssoDomain: "sso.acme.test", ssoProvider: "okta" },
      });

      const read = await world.api.get(`${ORGANIZATION_BASE}/`, ORGANIZATION_BEARER);

      expect(read.status).toBe(200);
      const body = (await read.json()) as Record<string, unknown>;
      expect(body).not.toHaveProperty("ssoDomain");
      expect(body).not.toHaveProperty("ssoProvider");
      expect(JSON.stringify(body)).not.toContain("sso.acme.test");

      const update = await world.api.patch(
        `${ORGANIZATION_BASE}/`,
        { name: "SSO Untouched", ssoDomain: "attacker.example.com", ssoProvider: "evil" },
        ORGANIZATION_BEARER,
      );

      expect(update.status).toBe(200);
      expect(world.organization()).toMatchObject({
        name: "SSO Untouched",
        ssoDomain: "sso.acme.test",
        ssoProvider: "okta",
      });
    });
  });
});

describe("given no credential at all", () => {
  describe("when the organization is fetched", () => {
    // @scenario "Fetching the organization without credentials is refused"
    it("refuses with missing_credentials before reading anything", async () => {
      const world = organizationWorld({ credentialed: false });

      const response = await world.api.get(`${ORGANIZATION_BASE}/`);

      expect(response.status).toBe(401);
      await expect(errorCodeOf(response)).resolves.toBe("missing_credentials");
    });
  });
});

describe("given the same endpoint addressed through its version namespaces", () => {
  describe("when each namespace is asked for the organization", () => {
    // @scenario "The organization endpoint answers on its dated and latest paths"
    it("serves the dated and latest paths and 404s a namespace that does not exist", async () => {
      const world = organizationWorld();

      const dated = await world.api.get(
        `/api/v1/organization/${MANAGEMENT_API_VERSION}/`,
        ORGANIZATION_BEARER,
      );
      expect(dated.status).toBe(200);
      expect(dated.headers.get("X-API-Version")).toBe(MANAGEMENT_API_VERSION);
      expect(dated.headers.get("X-API-Version-Status")).toBe("stable");

      const latest = await world.api.get("/api/v1/organization/latest/", ORGANIZATION_BEARER);
      expect(latest.status).toBe(200);
      expect(latest.headers.get("X-API-Version")).toBe("latest");
      expect(latest.headers.get("X-API-Version-Status")).toBe("latest");

      const unknown = await world.api.get("/api/v1/organization/2020-01-01/", ORGANIZATION_BEARER);
      expect(unknown.status).toBe(404);
    });
  });

  // Decision 20 (commit 771069e9): every family serves at /api/v1 and at
  // /api, and the bare path serves the latest registrations. The feature
  // file's "the bare path is gone (404)" note predates that and is stale.
  describe("when the family is addressed without its /v1 prefix or its namespace", () => {
    it("answers both aliases identically to the versioned path", async () => {
      const world = organizationWorld();

      const versioned = await world.api.get("/api/v1/organization/latest/", ORGANIZATION_BEARER);
      const unprefixed = await world.api.get("/api/organization/latest/", ORGANIZATION_BEARER);
      const bare = await world.api.get("/api/organization", ORGANIZATION_BEARER);

      const expected = await versioned.json();
      expect(unprefixed.status).toBe(versioned.status);
      await expect(unprefixed.json()).resolves.toEqual(expected);
      expect(bare.status).toBe(versioned.status);
      await expect(bare.json()).resolves.toEqual(expected);
    });
  });
});
