/**
 * The service resolves an organization's creation date on behalf of a "new
 * organizations" rule, so no call site has to carry a date almost no flag
 * needs.
 *
 * Two things matter here and neither is visible from the rule matcher alone:
 * a flag WITHOUT an age rule must not read the organization table at all (the
 * kill-switch path runs per event), and a flag WITH one must not read it per
 * check. Both are asserted against the repository's read count rather than
 * against the resolved boolean, because a resolver that fetched on every call
 * would return exactly the same answers.
 *
 * Spec: specs/ops/internal-feature-flags.feature
 */
import type { FeatureFlagRules } from "@langwatch/feature-flag-contract";
import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryFeatureFlagService } from "../testing";

const FLAG = "ops_es_causality_loop_guard_disabled";
const ROLLOUT_START = "2026-06-01";
const NEW_ORGANIZATION = "organization_new";
const OLD_ORGANIZATION = "organization_old";

function buildService() {
  const graph = createInMemoryFeatureFlagService();
  graph.repository.rememberOrganization({
    organizationId: NEW_ORGANIZATION,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
  });
  graph.repository.rememberOrganization({
    organizationId: OLD_ORGANIZATION,
    createdAt: new Date("2024-02-01T00:00:00.000Z"),
  });
  return graph;
}

async function writeRules(
  graph: ReturnType<typeof buildService>,
  rules: FeatureFlagRules,
): Promise<void> {
  await graph.service.setEnabled({ key: FLAG, enabled: false, lastEditedBy: "operator-1" });
  await graph.service.setRules({ key: FLAG, rules, lastEditedBy: "operator-1" });
}

const NEW_ORGANIZATIONS_RULE: FeatureFlagRules = [
  { match: { organizationCreatedAfter: ROLLOUT_START }, enabled: true },
];

function readFor(organizationId: string) {
  return { kind: "organization", organizationId } as const;
}

let graph: ReturnType<typeof buildService>;

beforeEach(() => {
  graph = buildService();
});

describe("given an operator rolled a flag out to organizations created from a date on", () => {
  describe("when the flag is read for an organization created after it", () => {
    /** @scenario "a new-users rule enables the flag for an organization created after its date" */
    it("resolves enabled, having looked the creation date up itself", async () => {
      await writeRules(graph, NEW_ORGANIZATIONS_RULE);

      await expect(graph.service.isEnabled(FLAG, readFor(NEW_ORGANIZATION))).resolves.toBe(true);
      expect(graph.repository.organizationReads).toBe(1);
    });
  });

  describe("when the flag is read for an organization that predates it", () => {
    /** @scenario "an organization that predates the rollout date sees no change" */
    it("resolves to the row-level value it had before the rule was written", async () => {
      await writeRules(graph, NEW_ORGANIZATIONS_RULE);

      await expect(graph.service.isEnabled(FLAG, readFor(OLD_ORGANIZATION))).resolves.toBe(false);
    });
  });

  describe("when the same organization reads the flag repeatedly", () => {
    /** @scenario "the creation date is fetched once and reused across reads" */
    it("reads the creation date once, because a creation date never changes", async () => {
      await writeRules(graph, NEW_ORGANIZATIONS_RULE);

      for (let attempt = 0; attempt < 25; attempt += 1) {
        await graph.service.isEnabled(FLAG, readFor(NEW_ORGANIZATION));
      }

      expect(graph.repository.organizationReads).toBe(1);
    });
  });

  describe("when the organization cannot be read", () => {
    /** @scenario "a stored rule whose date cannot be read never matches" */
    it("matches no age rule, so a database blip never widens a rollout", async () => {
      await writeRules(graph, NEW_ORGANIZATIONS_RULE);
      graph.repository.failNextOrganizationLookup();

      await expect(graph.service.isEnabled(FLAG, readFor(NEW_ORGANIZATION))).resolves.toBe(false);
    });
  });

  describe("when the read opted the organization scope out", () => {
    /** @scenario "a read with no organization creation date matches no age rule" */
    it("resolves the row-level value without reading any organization", async () => {
      await writeRules(graph, NEW_ORGANIZATIONS_RULE);

      await expect(graph.service.isEnabled(FLAG, { kind: "system" })).resolves.toBe(false);
      expect(graph.repository.organizationReads).toBe(0);
    });
  });
});

describe("given a flag whose rules name only organizations and projects", () => {
  describe("when it is read on the per-event kill-switch path", () => {
    /** @scenario "the creation date is fetched only for a flag that has an age rule" */
    it("never reads the organization table", async () => {
      await writeRules(graph, [{ match: { organizationId: OLD_ORGANIZATION }, enabled: true }]);

      await graph.service.isEnabled(FLAG, readFor(NEW_ORGANIZATION));

      expect(graph.repository.organizationReads).toBe(0);
    });
  });
});

describe("given a flag whose rules put an everyone rule above a New organizations rule", () => {
  describe("when the flag is read", () => {
    /** @scenario "no creation date is fetched for an age rule that cannot be reached" */
    it("never reads the organization table, the everyone rule having settled it", async () => {
      await writeRules(graph, [
        { match: {}, enabled: true },
        { match: { organizationCreatedAfter: ROLLOUT_START }, enabled: false },
      ]);

      await expect(graph.service.isEnabled(FLAG, readFor(NEW_ORGANIZATION))).resolves.toBe(true);
      expect(graph.repository.organizationReads).toBe(0);
    });
  });
});

describe("given a flag whose rules name this organization above a New organizations rule", () => {
  describe("when the flag is read for that organization", () => {
    /** @scenario "no creation date is fetched once an earlier rule already decides the read" */
    it("never reads the organization table, the first matching rule having answered", async () => {
      await writeRules(graph, [
        { match: { organizationId: NEW_ORGANIZATION }, enabled: true },
        { match: { organizationCreatedAfter: ROLLOUT_START }, enabled: false },
      ]);

      await expect(graph.service.isEnabled(FLAG, readFor(NEW_ORGANIZATION))).resolves.toBe(true);
      expect(graph.repository.organizationReads).toBe(0);
    });
  });
});
