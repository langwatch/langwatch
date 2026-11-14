// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import type { CustomerIoChannel } from "../../channels/customer-io.channel.ts";
import { MemoryNurturingRepositories } from "../../repositories/memory/memory.nurturing.repositories.ts";
import { NurturingModule } from "../nurturing.app.ts";

/** The real module, built with a Customer.io channel or without one. */
function moduleWith(customerIo: CustomerIoChannel | undefined): Promise<NurturingModule> {
  return NurturingModule.create({
    dependencies: {
      users: createApiFixture<UserApi>({}, "UserApi"),
      organizations: createApiFixture<OrganizationApi>({}, "OrganizationApi"),
    },
    config: {
      customerIoRegion: void 0,
      customerIoBaseUrl: void 0,
      posthogKey: void 0,
      posthogHost: void 0,
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    repositories: MemoryNurturingRepositories.create(),
    channels: { customerIo, posthog: void 0 },
  });
}

describe("given the nurturing module", () => {
  describe("when it is built with a Customer.io channel", () => {
    it("syncs organization usage", async () => {
      const app = await moduleWith(createApiFixture<CustomerIoChannel>({}, "CustomerIoChannel"));

      expect(app.syncsOrganizationUsage()).toBe(true);
    });
  });

  describe("when it is built without a Customer.io channel", () => {
    it("does not sync organization usage", async () => {
      const app = await moduleWith(void 0);

      expect(app.syncsOrganizationUsage()).toBe(false);
    });
  });
});
