// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 *
 * @see specs/api-reference/scim-api-reference.feature
 *
 * ServiceProviderConfig publishes `filter.maxResults`, and an identity
 * provider reads it as the page size this deployment will serve. A `count`
 * the handlers pass through unclamped turns that number into a promise nobody
 * keeps: `GET /Groups?count=1000000` expands every membership on the page
 * unless `excludedAttributes=members` is sent, so one request pulls the whole
 * directory. The published number and the applied cap are asserted together,
 * because either one alone can be right while the pair disagrees.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listUsers, listGroups, verifyEntitled } = vi.hoisted(() => ({
  listUsers: vi.fn(),
  listGroups: vi.fn(),
  verifyEntitled: vi.fn(),
}));

// The declared permission seam resolves its service from the App.
vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsMock } = await import(
    "~/test-utils/appPermissionsMock"
  );
  return appPermissionsMock();
});

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("@ee/scim/scim-token.service", () => ({
  ScimTokenService: { create: () => ({ verifyEntitled }) },
}));

vi.mock("@ee/scim/scim.service", () => ({
  ScimService: { create: () => ({ listUsers }) },
}));

vi.mock("@ee/scim/scim-group.service", () => ({
  ScimGroupService: { create: () => ({ listGroups }) },
}));

import { app } from "../routes";

const AUTH = { Authorization: "Bearer scim-token" };
const EMPTY_PAGE = {
  schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  totalResults: 0,
  itemsPerPage: 0,
  startIndex: 1,
  Resources: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  verifyEntitled.mockResolvedValue({ status: "ok", organizationId: "org_1" });
  listUsers.mockResolvedValue(EMPTY_PAGE);
  listGroups.mockResolvedValue(EMPTY_PAGE);
});

describe("SCIM list pagination", () => {
  describe("given a count above the published maximum", () => {
    it("serves /Users at the cap rather than the number asked for", async () => {
      const response = await app.request("/api/scim/v2/Users?count=1000000", {
        headers: AUTH,
      });

      expect(response.status).toBe(200);
      expect(listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ count: 100, startIndex: 1 }),
      );
    });

    it("serves /Groups at the cap rather than the number asked for", async () => {
      const response = await app.request("/api/scim/v2/Groups?count=1000000", {
        headers: AUTH,
      });

      expect(response.status).toBe(200);
      expect(listGroups).toHaveBeenCalledWith(
        expect.objectContaining({ count: 100, startIndex: 1 }),
      );
    });
  });

  describe("given a count below the published maximum", () => {
    it("serves the page size the caller asked for", async () => {
      await app.request("/api/scim/v2/Users?count=25", { headers: AUTH });

      expect(listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ count: 25 }),
      );
    });
  });

  describe("given no count at all", () => {
    it("falls back to the published maximum", async () => {
      await app.request("/api/scim/v2/Users", { headers: AUTH });

      expect(listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ count: 100 }),
      );
    });
  });

  describe("given ServiceProviderConfig is read", () => {
    it("publishes the same maximum the list handlers apply", async () => {
      const response = await app.request("/api/scim/v2/ServiceProviderConfig");

      const body = (await response.json()) as {
        filter: { maxResults: number };
      };
      expect(body.filter.maxResults).toBe(100);
    });
  });
});
