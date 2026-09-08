/**
 * @vitest-environment node
 * The experiment-setting contract, stated once and run against every backend
 * the package can reach. The memory twin runs always; a Postgres backend joins
 * the table when this package declares a datastore in its vitest config.
 * @see specs/feature-flag.feature
 */
import { describe, expect, it } from "vitest";

import type {
  ExperimentSubject,
  FeatureFlagExperimentRepository,
} from "../feature-flag-experiment-setting.repository.ts";
import { MemoryFeatureFlagExperimentRepository } from "../memory/memory.feature-flag-experiment-setting.repository.ts";

const backends: ReadonlyArray<{
  name: string;
  create: () => FeatureFlagExperimentRepository;
}> = [{ name: "memory", create: () => MemoryFeatureFlagExperimentRepository.create() }];

const OLIVE: ExperimentSubject = { subjectType: "USER", subjectId: "user_olive" };
const PAT: ExperimentSubject = { subjectType: "USER", subjectId: "user_pat" };
const ACME: ExperimentSubject = { subjectType: "ORGANIZATION", subjectId: "org_acme" };

describe.each(backends)("given the $name experiment setting repository", ({ create }) => {
  describe("when nobody has enrolled", () => {
    /** @scenario "The memory and Postgres feature flag repositories answer alike" */
    it("answers absence with no settings at all", async () => {
      const repository = create();

      await expect(
        repository.findForSubjects({ flagKeys: ["release_a"], subjects: [OLIVE] }),
      ).resolves.toEqual([]);
    });

    it("removes a setting nobody wrote without complaint", async () => {
      const repository = create();

      await expect(repository.remove({ flagKey: "release_a", ...OLIVE })).resolves.toBeUndefined();
    });
  });

  describe("when a person has enrolled", () => {
    it("reads their own setting back", async () => {
      const repository = create();

      await repository.upsert({
        flagKey: "release_a",
        ...OLIVE,
        enabled: true,
        changedByUserId: "user_olive",
      });

      await expect(
        repository.findForSubjects({ flagKeys: ["release_a"], subjects: [OLIVE] }),
      ).resolves.toEqual([{ flagKey: "release_a", ...OLIVE, enabled: true }]);
    });

    it("replaces the setting rather than adding a second one", async () => {
      const repository = create();

      await repository.upsert({
        flagKey: "release_a",
        ...OLIVE,
        enabled: true,
        changedByUserId: null,
      });
      await repository.upsert({
        flagKey: "release_a",
        ...OLIVE,
        enabled: false,
        changedByUserId: null,
      });

      await expect(
        repository.findForSubjects({ flagKeys: ["release_a"], subjects: [OLIVE] }),
      ).resolves.toEqual([{ flagKey: "release_a", ...OLIVE, enabled: false }]);
    });

    it("returns the setting to inherit when it is removed", async () => {
      const repository = create();

      await repository.upsert({
        flagKey: "release_a",
        ...ACME,
        enabled: true,
        changedByUserId: null,
      });
      await repository.remove({ flagKey: "release_a", ...ACME });

      await expect(
        repository.findForSubjects({ flagKeys: ["release_a"], subjects: [ACME] }),
      ).resolves.toEqual([]);
    });
  });

  describe("when settings belong to other subjects and other flags", () => {
    it("never answers with a setting the caller did not name", async () => {
      const repository = create();

      await repository.upsert({
        flagKey: "release_a",
        ...OLIVE,
        enabled: true,
        changedByUserId: null,
      });
      await repository.upsert({
        flagKey: "release_a",
        ...PAT,
        enabled: true,
        changedByUserId: null,
      });
      await repository.upsert({
        flagKey: "release_b",
        ...OLIVE,
        enabled: true,
        changedByUserId: null,
      });

      // A subject id is only ever read beside its type: an organization and a
      // person who happen to share an id are two different subjects.
      await repository.upsert({
        flagKey: "release_a",
        subjectType: "ORGANIZATION",
        subjectId: "user_olive",
        enabled: false,
        changedByUserId: null,
      });

      await expect(
        repository.findForSubjects({ flagKeys: ["release_a"], subjects: [OLIVE] }),
      ).resolves.toEqual([{ flagKey: "release_a", ...OLIVE, enabled: true }]);
    });

    it("answers every named flag for every named subject in one read", async () => {
      const repository = create();

      await repository.upsert({
        flagKey: "release_a",
        ...OLIVE,
        enabled: true,
        changedByUserId: null,
      });
      await repository.upsert({
        flagKey: "release_b",
        ...ACME,
        enabled: false,
        changedByUserId: null,
      });

      const settings = await repository.findForSubjects({
        flagKeys: ["release_a", "release_b"],
        subjects: [OLIVE, ACME],
      });

      expect(settings).toHaveLength(2);
      expect(settings).toEqual(
        expect.arrayContaining([
          { flagKey: "release_a", ...OLIVE, enabled: true },
          { flagKey: "release_b", ...ACME, enabled: false },
        ]),
      );
    });

    it("answers nothing when no flag or no subject is named", async () => {
      const repository = create();

      await repository.upsert({
        flagKey: "release_a",
        ...OLIVE,
        enabled: true,
        changedByUserId: null,
      });

      await expect(
        repository.findForSubjects({ flagKeys: [], subjects: [OLIVE] }),
      ).resolves.toEqual([]);
      await expect(
        repository.findForSubjects({ flagKeys: ["release_a"], subjects: [] }),
      ).resolves.toEqual([]);
    });
  });
});
