import { describe, expect, it } from "vitest";
import { migrationRunsOnThisInstallation, organizationMigrates } from "../ops.system-migration-cohort";

/** The cohort question for a migration enrollment still paces. */
function paced(args: Partial<Parameters<typeof organizationMigrates>[0]>): boolean {
  return organizationMigrates({
    isSaaS: true,
    enrolledAutomatically: false,
    enrolled: false,
    ...args,
  });
}

describe("organizationMigrates", () => {
  describe("when the installation is self-hosted", () => {
    /** @scenario "A self-hosted installation migrates every organization" */
    it("includes every organization, enrolled or not", () => {
      // `enrolledAutomatically` is supplied although self-hosted returns before
      // reading it: it is a required argument, and omitting it type-checked
      // only because nothing type-checks this file.
      const selfHosted = { isSaaS: false, enrolledAutomatically: false };
      expect(organizationMigrates({ ...selfHosted, enrolled: false })).toBe(true);
      expect(organizationMigrates({ ...selfHosted, enrolled: true })).toBe(true);
    });
  });

  describe("when the installation is cloud and the migration is paced by enrollment", () => {
    /** @scenario "Cloud rollout processes only enrolled organizations" */
    it("includes exactly the enrolled organizations", () => {
      // Through `paced`, which supplies `enrolledAutomatically: false` — the
      // premise of this describe. Calling `organizationMigrates` directly
      // omitted it, and `enrolled || enrolledAutomatically` then answered
      // `undefined` rather than `false`: the cloud branch reads the flag,
      // where the self-hosted case above returns before ever looking at it.
      expect(paced({ enrolled: true })).toBe(true);
      expect(paced({ enrolled: false })).toBe(false);
    });
  });
});

describe("migrationRunsOnThisInstallation", () => {
  describe("when the installation is cloud", () => {
    /** @scenario "Cloud rollout is unaffected by the self-hosted release declaration" */
    it("runs every registered migration whatever it declares", () => {
      expect(
        migrationRunsOnThisInstallation({
          isSaaS: true,
          runsAutomaticallyOnSelfHosted: false,
        }),
      ).toBe(true);
      expect(
        migrationRunsOnThisInstallation({
          isSaaS: true,
          runsAutomaticallyOnSelfHosted: true,
        }),
      ).toBe(true);
    });
  });

  describe("when the installation is self-hosted", () => {
    /** @scenario "A migration not yet released for self-hosting never runs there" */
    it("runs only the migrations released for self-hosting", () => {
      expect(
        migrationRunsOnThisInstallation({
          isSaaS: false,
          runsAutomaticallyOnSelfHosted: false,
        }),
      ).toBe(false);
      expect(
        migrationRunsOnThisInstallation({
          isSaaS: false,
          runsAutomaticallyOnSelfHosted: true,
        }),
      ).toBe(true);
    });
  });
});
