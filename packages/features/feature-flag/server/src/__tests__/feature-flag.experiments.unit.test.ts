/**
 * Experiment precedence through the real service graph: availability, the
 * durable tenant policy, and the person's own enrolment, with the settings
 * repository actually written and read back.
 *
 * The registry is a fixture built for these tests. The shipped registry
 * marks nothing as an experiment yet, and mutating it would be reaching into
 * production state to make a test pass.
 */
import {
  createFeatureFlagRegistry,
  FeatureFlagExperimentUnavailableError,
  UnknownFeatureFlagExperimentError,
  type FeatureFlagExperiment,
} from "@langwatch/feature-flag-contract";
import { describe, expect, it } from "vitest";
import { createInMemoryFeatureFlagService } from "../testing";

const FLAG = "release_ui_agent_testing_v2_enabled";
const NOT_AN_EXPERIMENT = "release_ui_ai_gateway_menu_enabled";
const USER_ID = "user_1";
const PROJECT_ID = "project_1";
const ORGANIZATION_ID = "org_1";

const EXPERIMENT: FeatureFlagExperiment = {
  title: "Navigation v2",
  summary: "The product-scoped navigation shells.",
  catalogueVersion: 3,
};

const PROJECT_TARGET = {
  kind: "project" as const,
  userId: USER_ID,
  projectId: PROJECT_ID,
  organizationId: ORGANIZATION_ID,
};
const ANONYMOUS = {
  kind: "anonymous" as const,
  anonymousId: "0b7f4b4e-2b1a-4a5e-9c4d-2f1e7a9b3c5d",
};

function harness({ experiment = EXPERIMENT }: { experiment?: FeatureFlagExperiment } = {}) {
  const registry = createFeatureFlagRegistry({
    definitions: [
      {
        key: FLAG,
        scope: "PRODUCT",
        defaultValue: false,
        description: "Fixture experiment.",
        experiment,
      },
      {
        key: NOT_AN_EXPERIMENT,
        scope: "PRODUCT",
        defaultValue: false,
        description: "Fixture flag that is not an experiment.",
      },
    ],
    browserVisibleKeys: [FLAG, NOT_AN_EXPERIMENT],
    publicAnonymousKeys: experiment.publicAnonymous ? [FLAG] : [],
  });
  const built = createInMemoryFeatureFlagService({ registry });
  const makeAvailable = () =>
    built.service.setEnabled({ key: FLAG, enabled: true, lastEditedBy: "operator" });

  return { ...built, makeAvailable };
}

describe("given an experiment that is available", () => {
  describe("when nobody has chosen anything", () => {
    it("is off, because an experiment is opt-in", async () => {
      const { service, makeAvailable } = harness();
      await makeAvailable();

      const [entry] = await service.resolveExperimentCatalogue(PROJECT_TARGET);

      expect(entry).toMatchObject({ enabled: false, decision: "user-not-enrolled" });
    });
  });

  describe("when the person opts themselves in", () => {
    it("turns on for them", async () => {
      const { service, makeAvailable } = harness();
      await makeAvailable();
      await service.setUserExperimentEnrolment({
        flagKey: FLAG,
        target: PROJECT_TARGET,
        enrolled: true,
      });

      const [entry] = await service.resolveExperimentCatalogue(PROJECT_TARGET);

      expect(entry).toMatchObject({
        enabled: true,
        decision: "user-enrolled",
        userEnrolled: true,
      });
    });

    it("shows in the resolved browser map too", async () => {
      const { service, makeAvailable } = harness();
      await makeAvailable();
      await service.setUserExperimentEnrolment({
        flagKey: FLAG,
        target: PROJECT_TARGET,
        enrolled: true,
      });

      await expect(service.resolveFrontendFlags(PROJECT_TARGET)).resolves.toMatchObject({
        [FLAG]: true,
      });
    });
  });

  describe("when the person opts back out", () => {
    it("removes the enrolment rather than storing a refusal", async () => {
      const { service, experiments, makeAvailable } = harness();
      await makeAvailable();
      await service.setUserExperimentEnrolment({
        flagKey: FLAG,
        target: PROJECT_TARGET,
        enrolled: true,
      });
      await service.setUserExperimentEnrolment({
        flagKey: FLAG,
        target: PROJECT_TARGET,
        enrolled: false,
      });

      await expect(
        experiments.findForSubjects({
          flagKeys: [FLAG],
          subjects: [{ subjectType: "USER", subjectId: USER_ID }],
        }),
      ).resolves.toEqual([]);
    });

    it("lets a later organization enable still reach them", async () => {
      const { service, makeAvailable } = harness();
      await makeAvailable();
      await service.setUserExperimentEnrolment({
        flagKey: FLAG,
        target: PROJECT_TARGET,
        enrolled: false,
      });
      await service.setExperimentTenantPolicy({
        flagKey: FLAG,
        scope: { kind: "organization", organizationId: ORGANIZATION_ID },
        policy: "enabled",
        changedByUserId: "owner_1",
      });

      const [entry] = await service.resolveExperimentCatalogue(PROJECT_TARGET);

      expect(entry).toMatchObject({ enabled: true, decision: "tenant-enabled" });
    });
  });

  describe("when an owner disables it for the organization", () => {
    it("overrides the person's own opt-in", async () => {
      const { service, makeAvailable } = harness();
      await makeAvailable();
      await service.setUserExperimentEnrolment({
        flagKey: FLAG,
        target: PROJECT_TARGET,
        enrolled: true,
      });
      await service.setExperimentTenantPolicy({
        flagKey: FLAG,
        scope: { kind: "organization", organizationId: ORGANIZATION_ID },
        policy: "disabled",
        changedByUserId: "owner_1",
      });

      const [entry] = await service.resolveExperimentCatalogue(PROJECT_TARGET);

      expect(entry).toMatchObject({ enabled: false, decision: "tenant-disabled" });
      expect(entry?.userEnrolled).toBe(true);
    });

    it("stays listed, so the owner can switch it back on", async () => {
      const { service, makeAvailable } = harness();
      await makeAvailable();
      await service.setExperimentTenantPolicy({
        flagKey: FLAG,
        scope: { kind: "organization", organizationId: ORGANIZATION_ID },
        policy: "disabled",
        changedByUserId: "owner_1",
      });

      await expect(service.resolveExperimentCatalogue(PROJECT_TARGET)).resolves.toHaveLength(1);
    });
  });

  describe("when the organization disables it and the project enables it", () => {
    it("follows the project", async () => {
      const { service, makeAvailable } = harness();
      await makeAvailable();
      await service.setExperimentTenantPolicy({
        flagKey: FLAG,
        scope: { kind: "organization", organizationId: ORGANIZATION_ID },
        policy: "disabled",
        changedByUserId: "owner_1",
      });
      await service.setExperimentTenantPolicy({
        flagKey: FLAG,
        scope: { kind: "project", projectId: PROJECT_ID },
        policy: "enabled",
        changedByUserId: "owner_1",
      });

      const [entry] = await service.resolveExperimentCatalogue(PROJECT_TARGET);

      expect(entry).toMatchObject({ enabled: true, decision: "tenant-enabled" });
    });
  });

  describe("when a policy is returned to inherit", () => {
    it("hands the decision back to the person", async () => {
      const { service, makeAvailable } = harness();
      await makeAvailable();
      await service.setExperimentTenantPolicy({
        flagKey: FLAG,
        scope: { kind: "organization", organizationId: ORGANIZATION_ID },
        policy: "enabled",
        changedByUserId: "owner_1",
      });
      await service.setExperimentTenantPolicy({
        flagKey: FLAG,
        scope: { kind: "organization", organizationId: ORGANIZATION_ID },
        policy: "inherit",
        changedByUserId: "owner_1",
      });

      const [entry] = await service.resolveExperimentCatalogue(PROJECT_TARGET);

      expect(entry).toMatchObject({ enabled: false, decision: "user-not-enrolled" });
    });
  });
});

describe("given an experiment the operator has not made available", () => {
  it("is not listed at all, so metadata never announces it", async () => {
    const { service } = harness();

    await expect(service.resolveExperimentCatalogue(PROJECT_TARGET)).resolves.toEqual([]);
  });

  it("refuses an attempt to join it", async () => {
    const { service } = harness();

    await expect(
      service.setUserExperimentEnrolment({
        flagKey: FLAG,
        target: PROJECT_TARGET,
        enrolled: true,
      }),
    ).rejects.toBeInstanceOf(FeatureFlagExperimentUnavailableError);
  });

  it("stays off even where an owner enabled it", async () => {
    const { service } = harness();
    await service.setExperimentTenantPolicy({
      flagKey: FLAG,
      scope: { kind: "project", projectId: PROJECT_ID },
      policy: "enabled",
      changedByUserId: "owner_1",
    });

    await expect(service.resolveFrontendFlags(PROJECT_TARGET)).resolves.toMatchObject({
      [FLAG]: false,
    });
  });
});

describe("given a key that is not an experiment", () => {
  it("refuses an enrolment", async () => {
    const { service } = harness();

    await expect(
      service.setUserExperimentEnrolment({
        flagKey: NOT_AN_EXPERIMENT,
        target: PROJECT_TARGET,
        enrolled: true,
      }),
    ).rejects.toBeInstanceOf(UnknownFeatureFlagExperimentError);
  });

  it("refuses a tenant policy", async () => {
    const { service } = harness();

    await expect(
      service.setExperimentTenantPolicy({
        flagKey: NOT_AN_EXPERIMENT,
        scope: { kind: "project", projectId: PROJECT_ID },
        policy: "disabled",
        changedByUserId: "owner_1",
      }),
    ).rejects.toBeInstanceOf(UnknownFeatureFlagExperimentError);
  });
});

describe("given a signed-out visitor", () => {
  it("is shown no experiment that did not opt into pre-authentication", async () => {
    const { service, makeAvailable } = harness();
    await makeAvailable();

    await expect(service.resolveExperimentCatalogue(ANONYMOUS)).resolves.toEqual([]);
  });

  it("cannot read an ordinary browser flag from the public surface", async () => {
    const { service, makeAvailable } = harness();
    await makeAvailable();

    await expect(service.resolvePublicAnonymousFlags(ANONYMOUS)).resolves.toEqual({});
  });

  describe("when the experiment opted into pre-authentication", () => {
    it("is decided by availability alone", async () => {
      const { service, makeAvailable } = harness({
        experiment: { ...EXPERIMENT, publicAnonymous: true },
      });
      await makeAvailable();

      const [entry] = await service.resolveExperimentCatalogue(ANONYMOUS);

      expect(entry).toMatchObject({ enabled: true, decision: "anonymous-bucket" });
    });

    it("appears on the public map", async () => {
      const { service, makeAvailable } = harness({
        experiment: { ...EXPERIMENT, publicAnonymous: true },
      });
      await makeAvailable();

      await expect(service.resolvePublicAnonymousFlags(ANONYMOUS)).resolves.toEqual({
        [FLAG]: true,
      });
    });
  });
});
