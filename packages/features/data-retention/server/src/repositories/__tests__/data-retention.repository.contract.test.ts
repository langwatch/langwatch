/**
 * @vitest-environment node
 * The retention-policy contract, stated once and run against every backend the
 * package can reach. The memory twin runs always; a Postgres backend joins the
 * table when this package declares a datastore in its vitest config.
 *
 * The policy table is keyed by organization, so the isolation case here is the
 * organization: a policy another organization wrote is never answered with.
 * @see specs/data-retention-service.feature
 */
import type { ScopeAssignment } from "@langwatch/data-retention-contract";
import { describe, expect, it } from "vitest";

import type { DataRetentionRepository } from "../data-retention.repository.ts";
import { MemoryDataRetentionRepository } from "../memory/memory.data-retention.repository.ts";

const backends: ReadonlyArray<{ name: string; create: () => DataRetentionRepository }> = [
  { name: "memory", create: () => MemoryDataRetentionRepository.create() },
];

const ACME = "org_acme";
const OTHER = "org_other";
const TEAM: ScopeAssignment = { scopeType: "TEAM", scopeId: "team_1" };
const PROJECT: ScopeAssignment = { scopeType: "PROJECT", scopeId: "project_1" };

describe.each(backends)("given the $name data retention repository", ({ create }) => {
  describe("when the organization has written no policy", () => {
    /** @scenario "The memory and Postgres data retention repositories answer alike" */
    it("answers a scope chain with no rows", async () => {
      const repository = create();

      await expect(
        repository.findForProjectChain({ organizationId: ACME, scopes: [PROJECT] }),
      ).resolves.toEqual([]);
    });

    it("lists nothing for the organization", async () => {
      const repository = create();

      await expect(repository.findAllInOrganization({ organizationId: ACME })).resolves.toEqual([]);
    });

    it("deletes a policy nobody wrote without complaint", async () => {
      const repository = create();

      await expect(
        repository.deleteForScope({ scope: TEAM, category: "traces" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when a policy is written for a scope", () => {
    it("reads the policy back on the scope's chain", async () => {
      const repository = create();

      await repository.upsertForScope({
        organizationId: ACME,
        scope: TEAM,
        category: "traces",
        retentionDays: 35,
      });

      await expect(
        repository.findForProjectChain({ organizationId: ACME, scopes: [TEAM, PROJECT] }),
      ).resolves.toEqual([{ ...TEAM, category: "traces", retentionDays: 35 }]);
    });

    it("lists the policy with the organization that wrote it", async () => {
      const repository = create();

      const written = await repository.upsertForScope({
        organizationId: ACME,
        scope: TEAM,
        category: "traces",
        retentionDays: 35,
      });

      expect(written).toMatchObject({ organizationId: ACME, ...TEAM, retentionDays: 35 });
      await expect(repository.findAllInOrganization({ organizationId: ACME })).resolves.toEqual([
        written,
      ]);
    });

    it("rewrites the same policy rather than adding a second one", async () => {
      const repository = create();

      const first = await repository.upsertForScope({
        organizationId: ACME,
        scope: TEAM,
        category: "traces",
        retentionDays: 35,
      });
      const second = await repository.upsertForScope({
        organizationId: ACME,
        scope: TEAM,
        category: "traces",
        retentionDays: 63,
      });

      expect(second.id).toBe(first.id);
      expect(second.retentionDays).toBe(63);
      await expect(repository.findAllInOrganization({ organizationId: ACME })).resolves.toHaveLength(
        1,
      );
    });

    it("keeps one scope's categories apart from each other", async () => {
      const repository = create();

      await repository.upsertForScope({
        organizationId: ACME,
        scope: TEAM,
        category: "traces",
        retentionDays: 35,
      });
      await repository.upsertForScope({
        organizationId: ACME,
        scope: TEAM,
        category: "scenarios",
        retentionDays: 63,
      });

      const listed = await repository.findAllInOrganization({ organizationId: ACME });

      expect(listed).toHaveLength(2);
      expect(listed.map((row) => row.category).sort()).toEqual(["scenarios", "traces"]);
    });

    it("removes only the category it was asked to remove", async () => {
      const repository = create();

      await repository.upsertForScope({
        organizationId: ACME,
        scope: TEAM,
        category: "traces",
        retentionDays: 35,
      });
      await repository.upsertForScope({
        organizationId: ACME,
        scope: TEAM,
        category: "scenarios",
        retentionDays: 63,
      });

      await repository.deleteForScope({ scope: TEAM, category: "traces" });

      const listed = await repository.findAllInOrganization({ organizationId: ACME });

      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ category: "scenarios" });
    });
  });

  describe("when another organization holds a policy on a scope of its own", () => {
    it("never answers a chain with the other organization's policy", async () => {
      const repository = create();

      await repository.upsertForScope({
        organizationId: OTHER,
        scope: TEAM,
        category: "traces",
        retentionDays: 35,
      });

      await expect(
        repository.findForProjectChain({ organizationId: ACME, scopes: [TEAM] }),
      ).resolves.toEqual([]);
    });

    it("never lists the other organization's policy", async () => {
      const repository = create();

      await repository.upsertForScope({
        organizationId: OTHER,
        scope: TEAM,
        category: "traces",
        retentionDays: 35,
      });

      await expect(repository.findAllInOrganization({ organizationId: ACME })).resolves.toEqual([]);
    });
  });
});
