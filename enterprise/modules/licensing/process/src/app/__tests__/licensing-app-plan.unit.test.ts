import { ResourceScope } from "@langwatch/kernel";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { ENTERPRISE_LICENSE_KEY, TAMPERED_LICENSE_KEY, TEST_PUBLIC_KEY } from "../../testing.ts";
import { LicensingApp, type LicensingInfrastructure } from "../licensing.app.ts";
import type { LicenseStorage } from "../licensing.members.ts";

describe("the installed licensing application's plan operation", () => {
  it("checks each organization's stored signature and preserves the unlicensed result", async () => {
    const keys = new Map([
      ["paid", ENTERPRISE_LICENSE_KEY],
      ["tampered", TAMPERED_LICENSE_KEY],
    ]);
    const tryReadLicense = vi.fn(
      async (organizationId: string) => keys.get(organizationId) ?? null,
    );
    const repository = createApiFixture<LicenseStorage>({ tryReadLicense });
    const app = LicensingApp.create({
      dependencies: {},
      members: { infrastructure: createApiFixture<LicensingInfrastructure>({ repository }) },
      config: { publicKey: TEST_PUBLIC_KEY, isSaas: true },
      resources: new ResourceScope(),
      secrets: new ScopedSecrets(async (_handle, build) => build(void 0)),
    });
    expect(await app.resolve({ organizationId: "paid" })).toMatchObject({
      type: "ENTERPRISE",
      free: false,
    });
    expect(await app.resolve({ organizationId: "unlicensed" })).toMatchObject({ free: true });
    expect(await app.resolve({ organizationId: "tampered" })).toMatchObject({ free: true });
    expect(tryReadLicense.mock.calls).toEqual([["paid"], ["unlicensed"], ["tampered"]]);
  });
});
