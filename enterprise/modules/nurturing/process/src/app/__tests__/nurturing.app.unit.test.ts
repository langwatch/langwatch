// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { Project, ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import type { CustomerIoChannel } from "../../channels/customer-io.channel.ts";
import { MemoryNurturingRepositories } from "../../repositories/memory/memory.nurturing.repositories.ts";
import { NurturingModule } from "../nurturing.app.ts";

/** The real module, built with a Customer.io channel or without one, over project's API. */
function moduleWith(
  customerIo: CustomerIoChannel | undefined,
  projects: Partial<ProjectApi> = {},
): Promise<NurturingModule> {
  return NurturingModule.create({
    dependencies: {
      users: createApiFixture<UserApi>({}, "UserApi"),
      organizations: createApiFixture<OrganizationApi>({}, "OrganizationApi"),
      projects: createApiFixture<ProjectApi>(projects, "ProjectApi"),
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

  describe("when a trace asks when an uncopied project was created", () => {
    const createdAt = new Date(Date.UTC(2026, 10, 20, 12));

    /** @scenario "A trace of a project older than nurturing's placement copy is dropped at once" */
    it("answers project's creation time, or none for a project project does not hold", async () => {
      const app = await moduleWith(void 0, {
        findById: async (id) => (id === "project-1" ? ({ createdAt } as Project) : null),
      });

      await expect(app.projectCreatedAt({ projectId: "project-1" })).resolves.toEqual({
        projectCreatedAt: createdAt.getTime(),
      });
      await expect(app.projectCreatedAt({ projectId: "project-9" })).resolves.toEqual({
        projectCreatedAt: null,
      });
    });
  });
});
