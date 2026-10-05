import { PermissionDeniedError } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import { EnterpriseGatewayApi } from "@langwatch/enterprise-gateway-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { createTestLogger } from "@langwatch/test-harness";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/enterprise-gateway/specs/enterprise-gateway.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { enterpriseGatewayProcessModule } from "../../enterprise-gateway.module.ts";

describe("given an operator acting as a member", () => {
  /** @scenario "No personal virtual key is issued while an operator acts as another member" */
  it("refuses the issue with permission_denied before membership is read", async () => {
    const isMember = vi.fn<OrganizationApi["isMember"]>(async () => {
      throw new Error("membership must not be read");
    });
    const { logger } = createTestLogger();
    const runtime = await createApp({ role: "api" })
      .withModules([enterpriseGatewayProcessModule])
      .withStores(memoryStores())
      .withObservability((observability) => observability.withLogging(logger))
      .provide({
        gateway: createApiFixture<GatewayApi>(),
        project: createApiFixture<ProjectApi>(),
        organization: createApiFixture<OrganizationApi>({ isMember }),
        authz: createApiFixture<AuthzApi>(),
        "model-provider": createApiFixture<ModelProviderApi>(),
      })
      .boot();

    try {
      const issuing = runtime.service(EnterpriseGatewayApi).issuePersonalVirtualKey({
        organizationId: "org_1",
        label: "laptop",
        actorUserId: "member-1",
        impersonatorId: "operator-1",
      });

      await expect(issuing).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(issuing).rejects.toMatchObject({ code: "permission_denied" });
      expect(isMember).not.toHaveBeenCalled();
    } finally {
      await runtime.stop();
    }
  });
});
