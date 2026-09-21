/**
 * The app authorizes the caller's exact organizationId before every
 * guided-onboarding read and write. Binds the `@integration` scenarios over
 * a memory fixture of `OrganizationApi`, pending its process-side read/write.
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { PermissionDeniedError, type AuthzApi } from "@langwatch/authz-contract";
import { ResourceScope } from "@langwatch/kernel";
import {
  EMPTY_GUIDED_ONBOARDING_STATE,
  type GuidedOnboardingRecord,
  type OnboardingServerConfig,
} from "@langwatch/onboarding-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingApp } from "../onboarding.app.ts";

const ORGANIZATION_ID = "organization_1";
const USER_ID = "user_1";

function testConfig(overrides: Partial<OnboardingServerConfig> = {}): OnboardingServerConfig {
  return {
    productAnalytics: { key: undefined, host: undefined },
    gateway: { publicUrl: undefined, baseUrl: undefined },
    ...overrides,
  };
}

function buildApp(
  options: {
    permitted?: boolean;
    config?: OnboardingServerConfig;
    record?: GuidedOnboardingRecord;
  } = {},
) {
  let record: GuidedOnboardingRecord = options.record ?? {
    state: EMPTY_GUIDED_ONBOARDING_STATE,
    variant: "guided",
  };
  const hasPermission = vi.fn(async () => options.permitted ?? true);
  const readGuidedOnboardingState = vi.fn(async () => record);
  const writeGuidedOnboardingState = vi.fn(async (input: { record: GuidedOnboardingRecord }) => {
    record = input.record;
    return record;
  });

  const app = OnboardingApp.create({
    dependencies: {
      permissions: createApiFixture<AuthzApi>({ hasPermission }),
      organizations: createApiFixture<OrganizationApi>({
        readGuidedOnboardingState,
        writeGuidedOnboardingState,
      }),
    },
    config: options.config ?? testConfig(),
    resources: new ResourceScope(),
    // No handle is ever resolved through it in these tests.
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });

  return { app, hasPermission, readGuidedOnboardingState, writeGuidedOnboardingState };
}

describe("OnboardingApp", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /** @scenario "a member of another organization cannot write the guided state" */
  it("refuses a caller without organization:view on the exact organization", async () => {
    const { app, writeGuidedOnboardingState } = buildApp({ permitted: false });

    await expect(
      app.recordPaths({ organizationId: ORGANIZATION_ID, userId: USER_ID, paths: ["llmops"] }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(writeGuidedOnboardingState).not.toHaveBeenCalled();
  });

  /** @scenario "an organization without guided state returns the empty default" */
  it("returns the empty default once authorized", async () => {
    const { app, hasPermission } = buildApp();

    const state = await app.getGuidedState({ organizationId: ORGANIZATION_ID, userId: USER_ID });

    expect(hasPermission).toHaveBeenCalledWith({
      userId: USER_ID,
      permission: "organization:view",
      organizationId: ORGANIZATION_ID,
    });
    expect(state).toMatchObject({ paths: [], donePaths: [], variant: "guided" });
    expect(state.gatewayUrl).toBeUndefined();
  });

  /** @scenario "recording paths stores them in pick order and starts the first one" */
  it("stores recorded paths in pick order and starts the first one", async () => {
    const { app } = buildApp();

    const state = await app.recordPaths({
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      paths: ["gateway", "llmops"],
    });

    expect(state.paths).toEqual(["gateway", "llmops"]);
    expect(state.currentPath).toBe("gateway");
  });

  it("adds the instance's gateway URL when the deployment declares one", async () => {
    const { app } = buildApp({
      config: testConfig({ gateway: { publicUrl: "https://gw.example.com", baseUrl: undefined } }),
    });

    const state = await app.beginPath({
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      path: "llmops",
    });

    expect(state.gatewayUrl).toBe("https://gw.example.com/v1");
  });
});
