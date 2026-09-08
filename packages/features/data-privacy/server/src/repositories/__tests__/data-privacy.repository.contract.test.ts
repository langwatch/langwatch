/**
 * @vitest-environment node
 * The privacy-rule contract, stated once and run against every backend the
 * package can reach. The memory twin runs always; a Postgres backend joins the
 * table when this package declares a datastore in its vitest config.
 *
 * The rules table is keyed by organization, so the isolation case here is the
 * organization: a rule another organization wrote is never answered with.
 * @see specs/data-privacy-service.feature
 */
import type { DataPrivacyConfig, DataPrivacyScope } from "@langwatch/data-privacy-contract";
import { describe, expect, it } from "vitest";

import type { DataPrivacyPolicyRepository } from "../data-privacy.repository.ts";
import { MemoryDataPrivacyPolicyRepository } from "../memory/memory.data-privacy.repository.ts";

const backends: ReadonlyArray<{ name: string; create: () => DataPrivacyPolicyRepository }> = [
  { name: "memory", create: () => MemoryDataPrivacyPolicyRepository.create() },
];

const ACME = "org_acme";
const OTHER = "org_other";
const TEAM: DataPrivacyScope = { scopeType: "TEAM", scopeId: "team_1" };
const PROJECT: DataPrivacyScope = { scopeType: "PROJECT", scopeId: "project_1" };

const DROP_INPUT: DataPrivacyConfig = { categories: { input: { disposition: "drop" } } };
const CAPTURE_INPUT: DataPrivacyConfig = { categories: { input: { disposition: "capture" } } };

describe.each(backends)("given the $name data privacy repository", ({ create }) => {
  describe("when the organization has written no rule", () => {
    /** @scenario "The memory and Postgres privacy rule repositories answer alike" */
    it("answers a scope chain with no rows", async () => {
      const repository = create();

      await expect(
        repository.findForProjectChain({
          organizationId: ACME,
          scopes: [{ ...PROJECT, personalOnly: false }],
        }),
      ).resolves.toEqual([]);
    });

    it("lists nothing for the organization", async () => {
      const repository = create();

      await expect(repository.findAllInOrganization({ organizationId: ACME })).resolves.toEqual([]);
    });

    it("deletes a rule nobody wrote without complaint", async () => {
      const repository = create();

      await expect(
        repository.deleteForScope({ organizationId: ACME, scope: TEAM, personalOnly: false }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when a rule is written for a scope", () => {
    it("reads the rule back on the scope's chain", async () => {
      const repository = create();

      await repository.upsertForScope({
        organizationId: ACME,
        scope: TEAM,
        personalOnly: false,
        config: DROP_INPUT,
      });

      await expect(
        repository.findForProjectChain({
          organizationId: ACME,
          scopes: [
            { ...TEAM, personalOnly: false },
            { ...PROJECT, personalOnly: false },
          ],
        }),
      ).resolves.toEqual([{ ...TEAM, personalOnly: false, config: DROP_INPUT }]);
    });

    it("lists the rule with the organization that wrote it", async () => {
      const repository = create();

      const written = await repository.upsertForScope({
        organizationId: ACME,
        scope: TEAM,
        personalOnly: false,
        config: DROP_INPUT,
      });

      expect(written).toMatchObject({ organizationId: ACME, ...TEAM, personalOnly: false });
      await expect(repository.findAllInOrganization({ organizationId: ACME })).resolves.toEqual([
        written,
      ]);
    });

    it("rewrites the same rule rather than adding a second one", async () => {
      const repository = create();

      const first = await repository.upsertForScope({
        organizationId: ACME,
        scope: TEAM,
        personalOnly: false,
        config: DROP_INPUT,
      });
      const second = await repository.upsertForScope({
        organizationId: ACME,
        scope: TEAM,
        personalOnly: false,
        config: CAPTURE_INPUT,
      });

      expect(second.id).toBe(first.id);
      expect(second.config).toEqual(CAPTURE_INPUT);
      await expect(repository.findAllInOrganization({ organizationId: ACME })).resolves.toHaveLength(
        1,
      );
    });

    it("keeps the personal-only rule apart from the shared one on the same scope", async () => {
      const repository = create();

      await repository.upsertForScope({
        organizationId: ACME,
        scope: TEAM,
        personalOnly: false,
        config: DROP_INPUT,
      });
      await repository.upsertForScope({
        organizationId: ACME,
        scope: TEAM,
        personalOnly: true,
        config: CAPTURE_INPUT,
      });

      const listed = await repository.findAllInOrganization({ organizationId: ACME });

      expect(listed).toHaveLength(2);
      expect(listed.map((row) => row.personalOnly).sort()).toEqual([false, true]);
    });

    it("removes only the rule it was asked to remove", async () => {
      const repository = create();

      await repository.upsertForScope({
        organizationId: ACME,
        scope: TEAM,
        personalOnly: false,
        config: DROP_INPUT,
      });
      await repository.upsertForScope({
        organizationId: ACME,
        scope: PROJECT,
        personalOnly: false,
        config: DROP_INPUT,
      });

      await repository.deleteForScope({
        organizationId: ACME,
        scope: TEAM,
        personalOnly: false,
      });

      const listed = await repository.findAllInOrganization({ organizationId: ACME });

      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject(PROJECT);
    });
  });

  describe("when another organization holds a rule on the same scope", () => {
    it("never answers a chain with the other organization's rule", async () => {
      const repository = create();

      await repository.upsertForScope({
        organizationId: OTHER,
        scope: TEAM,
        personalOnly: false,
        config: DROP_INPUT,
      });

      await expect(
        repository.findForProjectChain({
          organizationId: ACME,
          scopes: [{ ...TEAM, personalOnly: false }],
        }),
      ).resolves.toEqual([]);
    });

    it("never lists the other organization's rule", async () => {
      const repository = create();

      await repository.upsertForScope({
        organizationId: OTHER,
        scope: TEAM,
        personalOnly: false,
        config: DROP_INPUT,
      });

      await expect(repository.findAllInOrganization({ organizationId: ACME })).resolves.toEqual([]);
    });

    it("never deletes the other organization's rule", async () => {
      const repository = create();

      await repository.upsertForScope({
        organizationId: OTHER,
        scope: TEAM,
        personalOnly: false,
        config: DROP_INPUT,
      });

      await repository.deleteForScope({ organizationId: ACME, scope: TEAM, personalOnly: false });

      await expect(
        repository.findAllInOrganization({ organizationId: OTHER }),
      ).resolves.toHaveLength(1);
    });
  });
});
