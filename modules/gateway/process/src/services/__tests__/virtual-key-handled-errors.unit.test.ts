import {
  GatewayBudgetNotFoundError,
  GatewayOrganizationNotFoundError,
  GatewayRoutingPolicyForeignError,
  GatewayRoutingPolicyNotFoundError,
  VirtualKeyNotFoundError,
  VirtualKeyProvidersAllowedEmptyError,
  VirtualKeyProvidersNotInScopeError,
  VirtualKeyRevokedError,
  VirtualKeyRoutingPolicyConflictError,
  VirtualKeyRoutingPolicyRequiredError,
  VirtualKeyScopesRequiredError,
} from "@langwatch/gateway-contract";
import { HandledError } from "@langwatch/handled-error";
import type { ProjectApi } from "@langwatch/project-contract";
/**
 * The virtual-key services refuse with HandledErrors carrying the code and
 * status the platform family answered before: routing_policy_*, providers_*
 * and the rest, never a TRPCError the REST runtime cannot map.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { GatewayVirtualKeyRepository } from "../../repositories/gateway-virtual-key.repository.ts";
import type { GatewayScopeResolutionService } from "../gateway-scope-resolution.service.ts";
import { VirtualKeyValidationService } from "../virtual-key-validation.service.ts";

function validationOver(repository: Partial<GatewayVirtualKeyRepository>) {
  return VirtualKeyValidationService.create({
    repository: createApiFixture<GatewayVirtualKeyRepository>(repository),
    scopeResolution: createApiFixture<GatewayScopeResolutionService>({}),
    projects: createApiFixture<ProjectApi>({}),
  });
}

function refusalOf(attempt: () => unknown): unknown {
  try {
    attempt();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("the virtual-key services' refusals", () => {
  describe("given the codes and statuses the platform family answered before", () => {
    it.each([
      [new VirtualKeyRoutingPolicyRequiredError(), "routing_policy_required", 400],
      [new VirtualKeyRoutingPolicyConflictError("NONE"), "routing_policy_conflict", 400],
      [new VirtualKeyProvidersAllowedEmptyError(), "providers_allowed_empty", 400],
      [new VirtualKeyProvidersNotInScopeError(["a", "b"]), "providers_not_in_scope", 400],
      [new VirtualKeyScopesRequiredError(), "bad_request", 400],
      [new VirtualKeyRevokedError("Cannot update a revoked virtual key"), "bad_request", 400],
      [new GatewayRoutingPolicyNotFoundError("rp_1"), "not_found", 404],
      [new GatewayRoutingPolicyForeignError(), "forbidden", 403],
      [new GatewayOrganizationNotFoundError(), "not_found", 404],
      [new VirtualKeyNotFoundError(), "virtual_key_not_found", 404],
      [new GatewayBudgetNotFoundError(), "budget_not_found", 404],
    ])("%s answers %s with %s", (error, code, status) => {
      expect(error).toBeInstanceOf(HandledError);
      expect(error.code).toBe(code);
      expect(error.httpStatus).toBe(status);
      expect(error.fault).toBe("customer");
    });

    it("keeps the machine code ahead of the detail in the message", () => {
      expect(new VirtualKeyProvidersNotInScopeError(["a", "b"]).message).toBe(
        "providers_not_in_scope: a, b",
      );
      expect(new VirtualKeyRoutingPolicyConflictError("FALLBACK_ALL").message).toBe(
        "routing_policy_conflict: routingMode FALLBACK_ALL cannot carry a routingPolicyId",
      );
    });
  });

  describe("given a routing mode and a routing policy that disagree", () => {
    it("refuses POLICY without a policy id", () => {
      const refusal = refusalOf(() =>
        VirtualKeyValidationService.resolveRoutingMode("POLICY", null),
      );

      expect(refusal).toBeInstanceOf(VirtualKeyRoutingPolicyRequiredError);
    });

    it("refuses a policy id on a mode that does not use one", () => {
      const refusal = refusalOf(() =>
        VirtualKeyValidationService.resolveRoutingMode("NONE", "rp_1"),
      );

      expect(refusal).toBeInstanceOf(VirtualKeyRoutingPolicyConflictError);
    });

    it("infers POLICY from a policy id alone", () => {
      expect(VirtualKeyValidationService.resolveRoutingMode(undefined, "rp_1")).toBe("POLICY");
    });
  });

  describe("given an empty provider allow-list", () => {
    it("refuses it, and lets absence and null mean every provider", () => {
      expect(
        refusalOf(() => VirtualKeyValidationService.assertProvidersAllowedShape([])),
      ).toBeInstanceOf(VirtualKeyProvidersAllowedEmptyError);
      expect(VirtualKeyValidationService.assertProvidersAllowedShape(null)).toBeUndefined();
      expect(VirtualKeyValidationService.assertProvidersAllowedShape(undefined)).toBeUndefined();
    });
  });

  describe("given a routing policy the key names", () => {
    it("refuses one that does not exist, and one owned by another organization", async () => {
      const missing = validationOver({ findRoutingPolicyOwner: async () => null });
      const foreign = validationOver({
        findRoutingPolicyOwner: async () => ({ organizationId: "org_other" }),
      });

      await expect(missing.assertRoutingPolicyBelongsToOrg("rp_1", "org_1")).rejects.toBeInstanceOf(
        GatewayRoutingPolicyNotFoundError,
      );
      await expect(foreign.assertRoutingPolicyBelongsToOrg("rp_1", "org_1")).rejects.toBeInstanceOf(
        GatewayRoutingPolicyForeignError,
      );
    });
  });

  describe("given a key the organization does not hold", () => {
    it("refuses a mutation with the indistinguishable not-found answer", async () => {
      const validation = validationOver({ findById: async () => null });

      await expect(validation.ownedForMutation("vk_1", "org_1")).rejects.toBeInstanceOf(
        VirtualKeyNotFoundError,
      );
    });
  });
});
