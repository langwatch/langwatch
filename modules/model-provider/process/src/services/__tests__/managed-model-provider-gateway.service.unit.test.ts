import type { ManagedProviderApi } from "@langwatch/enterprise-managed-provider-contract";
/**
 * Managed status and managed-call parameters come from the managed-provider peer.
 * @see modules/model-provider/specs/model-provider.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { createModelProviderTestManagedProviders } from "../../app/__tests__/model-provider.fixture.ts";
import { ManagedModelProviderGatewayService } from "../managed-model-provider-gateway.service.ts";

const BEDROCK_CALL = {
  parameters: { model: "bedrock/claude", api_key: "customer-key" },
  projectId: "project-1",
  model: "bedrock/claude",
  provider: "bedrock",
};

function projectsIn(organizationId: string | undefined) {
  return { findOrganizationId: vi.fn(async () => organizationId) };
}

describe("ManagedModelProviderGatewayService", () => {
  describe("given the peer manages Bedrock for one organization", () => {
    const gateway = ManagedModelProviderGatewayService.create({
      managed: createModelProviderTestManagedProviders(["org-managed"]),
      projects: projectsIn("org-managed"),
    });

    /** @scenario Bedrock reads as managed for an organization the managed-provider peer manages */
    it("answers managed for that organization's Bedrock only", () => {
      expect(gateway.isManaged({ organizationId: "org-managed", provider: "bedrock" })).toBe(true);
      expect(gateway.isManaged({ organizationId: "org-managed", provider: "openai" })).toBe(false);
      expect(gateway.isManaged({ organizationId: "org-other", provider: "bedrock" })).toBe(false);
    });
  });

  describe("when a Bedrock call is prepared", () => {
    /** @scenario A managed call runs with the parameters the managed-provider peer builds */
    it("names the project's organization and runs with the peer's parameters", async () => {
      const buildLitellmParameters = vi.fn<ManagedProviderApi["buildLitellmParameters"]>(
        async () => ({ model: "bedrock/claude", aws_session_token: "session" }),
      );
      const projects = projectsIn("org-managed");
      const gateway = ManagedModelProviderGatewayService.create({
        managed: createApiFixture<ManagedProviderApi>({ buildLitellmParameters }),
        projects,
      });

      await expect(gateway.prepareParameters(BEDROCK_CALL)).resolves.toEqual({
        model: "bedrock/claude",
        aws_session_token: "session",
      });
      await gateway.prepareParameters(BEDROCK_CALL);

      expect(buildLitellmParameters).toHaveBeenCalledWith({
        params: BEDROCK_CALL.parameters,
        projectId: "project-1",
        organizationId: "org-managed",
        model: "bedrock/claude",
        modelProvider: { provider: "bedrock" },
      });
      expect(projects.findOrganizationId).toHaveBeenCalledTimes(1);
    });

    /** @scenario A managed call whose credentials cannot be assumed fails the call */
    it("fails with the peer's error when the role cannot be assumed", async () => {
      const gateway = ManagedModelProviderGatewayService.create({
        managed: createApiFixture<ManagedProviderApi>({
          buildLitellmParameters: async () => {
            throw new Error("Failed to get customer credentials");
          },
        }),
        projects: projectsIn("org-managed"),
      });

      await expect(gateway.prepareParameters(BEDROCK_CALL)).rejects.toThrow(
        "Failed to get customer credentials",
      );
    });

    it("runs with the caller's parameters when the project has no organization", async () => {
      const buildLitellmParameters = vi.fn<ManagedProviderApi["buildLitellmParameters"]>();
      const gateway = ManagedModelProviderGatewayService.create({
        managed: createApiFixture<ManagedProviderApi>({ buildLitellmParameters }),
        projects: projectsIn(undefined),
      });

      await expect(gateway.prepareParameters(BEDROCK_CALL)).resolves.toBe(BEDROCK_CALL.parameters);
      expect(buildLitellmParameters).not.toHaveBeenCalled();
    });
  });
});
