import { describe, expect, it } from "vitest";
import {
  migrationRunsOnThisInstallation,
  organizationMigrates,
} from "../cohort";

/** The cohort question for a migration enrollment still paces. */
function paced(
  args: Partial<Parameters<typeof organizationMigrates>[0]>,
): boolean {
  return organizationMigrates({
    isSaaS: true,
    enrolledAutomatically: false,
    hasPrivateDataplane: false,
    enrolled: false,
    ...args,
  });
}

describe("organizationMigrates", () => {
  describe("when the installation is self-hosted", () => {
    /** @scenario "A self-hosted installation migrates every organization" */
    it("includes every organization, enrolled or not", () => {
      expect(paced({ isSaaS: false, enrolled: false })).toBe(true);
      expect(paced({ isSaaS: false, enrolled: true })).toBe(true);
    });
  });

  describe("when the installation is cloud and the migration is paced by enrollment", () => {
    /** @scenario "Cloud rollout processes only enrolled organizations" */
    it("includes exactly the enrolled organizations", () => {
      expect(paced({ enrolled: true })).toBe(true);
      expect(paced({ enrolled: false })).toBe(false);
    });
  });

  describe("when the installation is cloud and the migration is enrolled automatically", () => {
    /** @scenario "A migration can declare that every organization is in its cohort" */
    it("includes an organization nobody enrolled", () => {
      expect(paced({ enrolledAutomatically: true, enrolled: false })).toBe(
        true,
      );
    });

    /** @scenario "An automatic cohort leaves out a private-dataplane organization" */
    it("leaves out an organization running a private data plane", () => {
      expect(
        paced({
          enrolledAutomatically: true,
          hasPrivateDataplane: true,
          enrolled: false,
        }),
      ).toBe(false);
    });

    /** @scenario "An operator can still enroll a private-dataplane organization by name" */
    it("includes a private-dataplane organization an operator enrolled deliberately", () => {
      expect(
        paced({
          enrolledAutomatically: true,
          hasPrivateDataplane: true,
          enrolled: true,
        }),
      ).toBe(true);
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
