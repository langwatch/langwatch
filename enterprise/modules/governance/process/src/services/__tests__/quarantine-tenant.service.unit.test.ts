// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { PROJECT_KIND, type ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import { ProjectQuarantineTenantResolverService } from "../quarantine-tenant.service.ts";

describe("ProjectQuarantineTenantResolverService", () => {
  describe("when an organization's quarantine tenant is resolved", () => {
    it("ensures the internal governance project and answers its id", async () => {
      const ensureInternal: Pick<ProjectApi, "ensureInternal">["ensureInternal"] = vi
        .fn()
        .mockResolvedValue({ id: "project_internal_1" });
      const projects: Pick<ProjectApi, "ensureInternal"> = { ensureInternal };
      const resolver = ProjectQuarantineTenantResolverService.create(projects);

      const tenantId = await resolver.resolveTenantId("org_1");

      expect(ensureInternal).toHaveBeenCalledWith({
        organizationId: "org_1",
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
      });
      expect(tenantId).toBe("project_internal_1");
    });
  });
});
