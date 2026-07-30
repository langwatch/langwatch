/**
 * The project -> organization lookup behind the billing meter poke.
 *
 * This sits on the busiest path in the product: every billable event resolves
 * its project's organization before anything else happens. The TTL cache in
 * front of it is the only reason that is affordable, and it had no test at all
 * — the one that covered it (a reactor integration test asserting Prisma was
 * hit once across two events) was deleted with the reactor, and every consumer
 * test since mocks this module out. A regression here re-queries Postgres per
 * billable event and shows up as latency, never as a red test.
 *
 * The module-level cache is a singleton, so each test uses its own project id
 * rather than resetting shared state.
 *
 * @see specs/licensing/billing-meter-dispatch.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveOrganizationId } from "../resolveOrganizationId";

const prismaMock = vi.hoisted(() => ({
  project: { findUnique: vi.fn() },
}));
vi.mock("~/server/db", () => ({ prisma: prismaMock }));

// No Redis under test, so the cache exercises its in-memory tier — the same
// tier a pod falls back to when Redis is unavailable in production.
vi.mock("~/server/redis", () => ({
  isBuildOrNoRedis: true,
  connection: undefined,
}));

function projectInOrg(organizationId: string) {
  return { team: { organizationId } };
}

describe("resolveOrganizationId", () => {
  beforeEach(() => {
    prismaMock.project.findUnique.mockReset();
  });

  describe("given a project seen for the first time", () => {
    /** @scenario "The project's organization is looked up once per cache window" */
    it("reads it from the database and returns its organization", async () => {
      prismaMock.project.findUnique.mockResolvedValue(projectInOrg("org-cold"));

      const organizationId = await resolveOrganizationId("proj-cold");

      expect(organizationId).toBe("org-cold");
      expect(prismaMock.project.findUnique).toHaveBeenCalledTimes(1);
      expect(prismaMock.project.findUnique).toHaveBeenCalledWith({
        where: { id: "proj-cold" },
        select: { team: { select: { organizationId: true } } },
      });
    });
  });

  describe("given the same project resolves again inside the cache window", () => {
    /** @scenario "The project's organization is looked up once per cache window" */
    it("answers from the cache without touching the database", async () => {
      prismaMock.project.findUnique.mockResolvedValue(projectInOrg("org-warm"));

      const first = await resolveOrganizationId("proj-warm");
      prismaMock.project.findUnique.mockClear();
      const second = await resolveOrganizationId("proj-warm");
      const third = await resolveOrganizationId("proj-warm");

      expect(first).toBe("org-warm");
      expect(second).toBe("org-warm");
      expect(third).toBe("org-warm");
      expect(prismaMock.project.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("given two different projects", () => {
    /** @scenario "The project's organization is looked up once per cache window" */
    it("caches each on its own key rather than sharing one answer", async () => {
      prismaMock.project.findUnique
        .mockResolvedValueOnce(projectInOrg("org-a"))
        .mockResolvedValueOnce(projectInOrg("org-b"));

      const a = await resolveOrganizationId("proj-a");
      const b = await resolveOrganizationId("proj-b");

      expect(a).toBe("org-a");
      expect(b).toBe("org-b");
      expect(prismaMock.project.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe("given an orphan project with no team", () => {
    it("returns nothing and does not cache the miss", async () => {
      prismaMock.project.findUnique.mockResolvedValue({ team: null });

      const first = await resolveOrganizationId("proj-orphan");
      const second = await resolveOrganizationId("proj-orphan");

      expect(first).toBeUndefined();
      expect(second).toBeUndefined();
      // Deliberate: an orphan project can be adopted, and a cached "no owner"
      // would keep it unbilled for the whole TTL after it is. The cost is a
      // read per event for a project that produces almost none.
      expect(prismaMock.project.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe("given the project row is missing entirely", () => {
    it("returns nothing rather than throwing on the billing path", async () => {
      prismaMock.project.findUnique.mockResolvedValue(null);

      await expect(resolveOrganizationId("proj-gone")).resolves.toBeUndefined();
    });
  });
});
