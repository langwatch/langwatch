/**
 * @see specs/groups/groups-rest-api.feature
 * The family's routes were documented and implemented while nothing mounted them, so every
 * documented call answered 404. Driven here the way the process actually mounts it.
 */
import type { OrganizationService } from "@langwatch/organization-contract";
import { describe, expect, it, vi } from "vitest";

import { REST_AUTH_ORGANIZATION, RestAuthWorld, type RestAuthKey } from "./support/rest-auth.world";
import { mountRestFamily } from "./support/rest-family.harness";

const ORGANIZATION_KEY = "sk-lw-alpha-organization";

const KEYS: readonly RestAuthKey[] = [
  {
    token: ORGANIZATION_KEY,
    kind: "organization",
    organizationId: REST_AUTH_ORGANIZATION,
    apiKeyId: "key-organization",
    role: "org-admin",
  },
];

describe("given the groups family the process mounts", () => {
  describe("when an organization credential lists the groups", () => {
    /** @scenario "The groups API is reachable through the composed router" */
    it("answers the documented page rather than a 404 from an unmounted family", async () => {
      const world = RestAuthWorld.create({ keys: KEYS });
      const listGroups = vi.fn(async () => ({
        data: [],
        pagination: { page: 1, limit: 50, total: 0 },
      }));
      const api = mountRestFamily({
        security: world.security(),
        packaged: {
          organizations: () => ({ listGroups }) as unknown as OrganizationService,
        } as never,
        packagedPorts: { enterpriseGate: () => async (_c, next) => next() },
      });

      const response = await api.get("/api/groups", {
        authorization: `Bearer ${ORGANIZATION_KEY}`,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: [],
        pagination: { page: 1, limit: 50, total: 0 },
      });
      expect(listGroups).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: REST_AUTH_ORGANIZATION }),
      );
    });
  });
});
