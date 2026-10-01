import type { GatewayApi } from "@langwatch/gateway-contract";
import type { InstantEvalApi } from "@langwatch/instant-eval-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import {
  ENTERPRISE_LICENSE_KEY,
  TAMPERED_LICENSE_KEY,
  TEST_LICENSING_CONFIG,
} from "../../__tests__/testing.ts";
import { LicensingModule, type LicensingInfrastructure } from "../licensing.app.ts";
import type { LicenseStorage } from "../licensing.members.ts";

describe("the installed licensing application's plan operation", () => {
  it("checks each organization's stored signature and preserves the unlicensed result", async () => {
    const keys = new Map([
      ["paid", ENTERPRISE_LICENSE_KEY],
      ["tampered", TAMPERED_LICENSE_KEY],
    ]);
    const getOrganizationLicense = vi.fn(async (organizationId: string) => ({
      licenseKey: keys.get(organizationId) ?? null,
    }));
    const repository = createApiFixture<LicenseStorage>({ getOrganizationLicense });
    const app = await LicensingModule.create({
      dependencies: {
        instantEval: createApiFixture<InstantEvalApi>(),
        projects: createApiFixture<ProjectApi>(),
        gateway: createApiFixture<GatewayApi>(),
        organizations: createApiFixture<OrganizationApi>(),
      },
      members: {
        infrastructure: createApiFixture<LicensingInfrastructure>({ repository }),
        isSaas: true,
        serviceVersion: "test",
      },
      config: TEST_LICENSING_CONFIG,
      resources: new ResourceScope(),
      secrets: new ScopedSecrets(async (_handle, build) => build(void 0)),
    });
    expect(await app.resolve({ organizationId: "paid" })).toMatchObject({
      granted: true,
      plan: { type: "ENTERPRISE", free: false },
    });
    expect(await app.resolve({ organizationId: "unlicensed" })).toMatchObject({
      granted: true,
      plan: { free: true },
    });
    expect(await app.resolve({ organizationId: "tampered" })).toMatchObject({
      granted: true,
      plan: { free: true },
    });
    expect(getOrganizationLicense.mock.calls).toEqual([["paid"], ["unlicensed"], ["tampered"]]);
  });
});
