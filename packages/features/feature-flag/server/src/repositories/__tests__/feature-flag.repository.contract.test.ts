/**
 * @vitest-environment node
 * The operator-row contract, stated once and run against every backend the
 * package can reach. The memory twin runs always; a Postgres backend joins the
 * table when this package declares a datastore in its vitest config.
 * @see specs/feature-flag.feature
 */
import type { FeatureFlagRules } from "@langwatch/feature-flag-contract";
import { describe, expect, it } from "vitest";

import type { FeatureFlagRepository } from "../feature-flag.repository.ts";
import { MemoryFeatureFlagRepository } from "../memory/memory.feature-flag.repository.ts";

const backends: ReadonlyArray<{ name: string; create: () => FeatureFlagRepository }> = [
  { name: "memory", create: () => MemoryFeatureFlagRepository.create() },
];

const RULES: FeatureFlagRules = [{ match: { organizationId: "org_acme" }, enabled: true }];

describe.each(backends)("given the $name feature flag repository", ({ create }) => {
  describe("when no row exists for the key", () => {
    /** @scenario "The memory and Postgres feature flag repositories answer alike" */
    it("answers absence with null rather than a refusal", async () => {
      const repository = create();

      await expect(repository.findByKey("release_absent")).resolves.toBeNull();
    });

    it("lists nothing", async () => {
      const repository = create();

      await expect(repository.findAll()).resolves.toEqual([]);
    });

    it("deletes a key nobody wrote without complaint", async () => {
      const repository = create();

      await expect(repository.deleteByKey("release_absent")).resolves.toBeUndefined();
    });
  });

  describe("when an operator writes the enabled flag", () => {
    it("reads the written value back", async () => {
      const repository = create();

      await repository.upsertEnabled({
        key: "release_a",
        enabled: true,
        lastEditedBy: "user_olive",
      });

      await expect(repository.findByKey("release_a")).resolves.toEqual({
        enabled: true,
        rules: [],
      });
    });

    it("keeps the targeting rules the row already carried", async () => {
      const repository = create();

      await repository.upsertRules({
        key: "release_a",
        rules: RULES,
        seedEnabled: false,
        lastEditedBy: "user_olive",
      });
      await repository.upsertEnabled({
        key: "release_a",
        enabled: true,
        lastEditedBy: "user_pat",
      });

      await expect(repository.findByKey("release_a")).resolves.toEqual({
        enabled: true,
        rules: RULES,
      });
    });
  });

  describe("when an operator writes targeting rules", () => {
    it("seeds the row-level value on the first write", async () => {
      const repository = create();

      await repository.upsertRules({
        key: "release_a",
        rules: RULES,
        seedEnabled: true,
        lastEditedBy: null,
      });

      await expect(repository.findByKey("release_a")).resolves.toEqual({
        enabled: true,
        rules: RULES,
      });
    });

    it("leaves an existing row-level value alone", async () => {
      const repository = create();

      await repository.upsertEnabled({ key: "release_a", enabled: false, lastEditedBy: null });
      await repository.upsertRules({
        key: "release_a",
        rules: RULES,
        seedEnabled: true,
        lastEditedBy: null,
      });

      await expect(repository.findByKey("release_a")).resolves.toMatchObject({ enabled: false });
    });
  });

  describe("when several rows exist", () => {
    it("lists every row ordered by key", async () => {
      const repository = create();

      await repository.upsertEnabled({ key: "release_b", enabled: true, lastEditedBy: "user_pat" });
      await repository.upsertEnabled({ key: "release_a", enabled: false, lastEditedBy: null });

      const listed = await repository.findAll();

      expect(listed.map((row) => row.key)).toEqual(["release_a", "release_b"]);
      expect(listed[0]).toMatchObject({ enabled: false, rules: [], lastEditedBy: null });
      expect(listed[1]).toMatchObject({ enabled: true, lastEditedBy: "user_pat" });
    });

    it("removes only the key it was asked to remove", async () => {
      const repository = create();

      await repository.upsertEnabled({ key: "release_a", enabled: true, lastEditedBy: null });
      await repository.upsertEnabled({ key: "release_b", enabled: true, lastEditedBy: null });

      await repository.deleteByKey("release_a");

      await expect(repository.findByKey("release_a")).resolves.toBeNull();
      await expect(repository.findByKey("release_b")).resolves.not.toBeNull();
    });
  });
});
