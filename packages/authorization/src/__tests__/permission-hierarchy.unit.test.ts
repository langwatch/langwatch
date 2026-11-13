/**
 * The manage-implication rule: every role bag, every custom role and every
 * `useCan` call reaches a verdict through this one function.
 * Spec: modules/authz/specs/permission-resolution.feature
 */
import { describe, expect, it } from "vitest";

import {
  ALL_PERMISSIONS,
  authzPermissionSchema,
  findPermissionIndex,
  grantablePermissionSchema,
  isGrantablePermission,
  permissionSatisfiedBy,
  SPAN_BRAID_PERMISSION,
} from "../registry.ts";

/** Every permission before `braids:manage`, at its bitset index. Never edit; append below it. */
const INDICES_BEFORE_BRAIDS = [
  "organization:view",
  "organization:manage",
  "organization:delete",
  "project:view",
  "project:create",
  "project:update",
  "project:delete",
  "project:manage",
  "team:view",
  "team:manage",
  "analytics:view",
  "analytics:create",
  "analytics:update",
  "analytics:delete",
  "analytics:manage",
  "cost:view",
  "traces:view",
  "traces:create",
  "traces:update",
  "traces:share",
  "scenarios:view",
  "scenarios:create",
  "scenarios:update",
  "scenarios:delete",
  "scenarios:manage",
  "annotations:view",
  "annotations:create",
  "annotations:update",
  "annotations:delete",
  "annotations:manage",
  "evaluations:view",
  "evaluations:create",
  "evaluations:update",
  "evaluations:delete",
  "evaluations:manage",
  "datasets:view",
  "datasets:create",
  "datasets:update",
  "datasets:delete",
  "datasets:manage",
  "triggers:view",
  "triggers:create",
  "triggers:update",
  "triggers:delete",
  "triggers:manage",
  "workflows:view",
  "workflows:create",
  "workflows:update",
  "workflows:delete",
  "workflows:manage",
  "experiments:view",
  "experiments:create",
  "experiments:update",
  "experiments:delete",
  "experiments:manage",
  "prompts:view",
  "prompts:create",
  "prompts:update",
  "prompts:delete",
  "prompts:manage",
  "secrets:view",
  "secrets:create",
  "secrets:update",
  "secrets:delete",
  "secrets:manage",
  "playground:view",
  "playground:create",
  "playground:update",
  "playground:delete",
  "playground:manage",
  "ops:view",
  "ops:manage",
  "auditLog:view",
  "virtualKeys:view",
  "virtualKeys:create",
  "virtualKeys:update",
  "virtualKeys:delete",
  "virtualKeys:rotate",
  "virtualKeys:manage",
  "virtualKeys:viewOtherPersonal",
  "gatewayBudgets:view",
  "gatewayBudgets:create",
  "gatewayBudgets:update",
  "gatewayBudgets:delete",
  "gatewayBudgets:manage",
  "gatewayProviders:view",
  "gatewayProviders:update",
  "gatewayProviders:manage",
  "routingPolicies:view",
  "routingPolicies:manage",
  "gatewayGuardrails:view",
  "gatewayGuardrails:attach",
  "gatewayGuardrails:detach",
  "gatewayGuardrails:manage",
  "gatewayLogs:view",
  "gatewayUsage:view",
  "gatewayCacheRules:view",
  "gatewayCacheRules:create",
  "gatewayCacheRules:update",
  "gatewayCacheRules:delete",
  "gatewayCacheRules:manage",
  "governance:view",
  "governance:manage",
  "ingestionSources:view",
  "ingestionSources:create",
  "ingestionSources:update",
  "ingestionSources:delete",
  "ingestionSources:manage",
  "anomalyRules:view",
  "anomalyRules:create",
  "anomalyRules:update",
  "anomalyRules:delete",
  "anomalyRules:manage",
  "complianceExport:view",
  "activityMonitor:view",
  "aiTools:view",
  "aiTools:manage",
  "webhookEndpoints:view",
  "webhookEndpoints:manage",
  "gatewaySpend:view",
  "gatewaySpend:manage",
  "langy:view",
  "langy:create",
  "langy:update",
  "langy:delete",
  "langy:manage",
  "agentCache:view",
  "agentCache:manage",
  "featureFlags:manageExperiments",
  "governanceCost:view",
  "sso:view",
  "sso:manage",
  "agents:deploy",
  "evaluators:deploy",
  "subscription:upgrade",
  "subscription:manage",
  "seatRequests:view",
  "seatRequests:manage",
  "members:view",
] as const;

const satisfies = (granted: readonly string[], requested: string): boolean =>
  permissionSatisfiedBy({ granted: new Set(granted), requested });

describe("given a bag of granted permissions", () => {
  describe("when the requested permission is in the bag", () => {
    /** @scenario "A direct grant satisfies its own request" */
    it.concurrent("satisfies it directly", () => {
      expect(satisfies(["workflows:view", "datasets:manage"], "workflows:view")).toBe(true);
      expect(satisfies(["workflows:view", "datasets:manage"], "datasets:manage")).toBe(true);
    });
  });

  describe("when the bag holds manage on the requested resource", () => {
    /** @scenario "A manage grant satisfies the read and write actions on its resource" */
    it.concurrent("satisfies view, create, update and delete on that resource", () => {
      for (const action of ["view", "create", "update", "delete"]) {
        expect(satisfies(["workflows:manage"], `workflows:${action}`)).toBe(true);
      }
    });

    /** @scenario "A manage grant satisfies the read and write actions on its resource" */
    it.concurrent("satisfies the manage request itself", () => {
      expect(satisfies(["workflows:manage"], "workflows:manage")).toBe(true);
    });

    /** @scenario "A grant on one resource never reaches another" */
    it.concurrent("does not reach a different resource", () => {
      expect(satisfies(["datasets:manage"], "workflows:view")).toBe(false);
      expect(satisfies(["datasets:manage"], "workflows:manage")).toBe(false);
    });
  });

  describe("when the bag holds organization:manage but not organization:delete", () => {
    /** @scenario "Deleting the organization is never implied by managing it" */
    it.concurrent("refuses organization:delete — deleting the org is an explicit grant only", () => {
      expect(satisfies(["organization:manage"], "organization:delete")).toBe(false);
    });

    /** @scenario "Deleting the organization is never implied by managing it" */
    it.concurrent("still satisfies view on the organization", () => {
      expect(satisfies(["organization:manage"], "organization:view")).toBe(true);
    });

    /** @scenario "Deleting the organization is never implied by managing it" */
    it.concurrent("satisfies organization:delete when it is granted directly", () => {
      expect(satisfies(["organization:manage", "organization:delete"], "organization:delete")).toBe(
        true,
      );
    });
  });

  describe("when the bag holds only view on the requested resource", () => {
    /** @scenario "A view grant never satisfies manage" */
    it.concurrent("refuses manage — the implication runs one way only", () => {
      expect(satisfies(["workflows:view"], "workflows:view")).toBe(true);
      expect(satisfies(["workflows:view"], "workflows:manage")).toBe(false);
    });
  });

  describe("when the bag is empty", () => {
    /** @scenario "An empty permission bag satisfies nothing" */
    it.concurrent("satisfies nothing", () => {
      expect(satisfies([], "workflows:view")).toBe(false);
      expect(satisfies([], "workflows:manage")).toBe(false);
    });
  });

  describe("when the resource has no manage action at all", () => {
    /** @scenario "Sharing a trace is not implied by any manage grant" */
    it.concurrent("grants traces:share directly and never widens it to a read", () => {
      expect(satisfies(["traces:share"], "traces:share")).toBe(true);
      expect(satisfies(["traces:share"], "traces:view")).toBe(false);
    });

    /** @scenario "Sharing a trace is not implied by any manage grant" */
    it.concurrent("cannot be reached through a manage grant that no bag issues", () => {
      expect(satisfies(["triggers:manage"], "triggers:view")).toBe(true);
      expect(satisfies(["traces:manage"], "traces:share")).toBe(false);
    });
  });

  describe("when the requested string is malformed", () => {
    /** @scenario "A malformed permission request matches nothing" */
    it.concurrent("refuses a bare resource, a bare action and an empty action", () => {
      expect(satisfies(["workflows:manage"], "workflows:")).toBe(false);
      expect(satisfies(["workflows:manage"], ":view")).toBe(false);
      expect(satisfies(["workflows:manage"], "workflows")).toBe(false);
    });
  });

  describe("when the request differs only in case", () => {
    /** @scenario "Permission comparison is case sensitive" */
    it.concurrent("refuses it — permissions are compared exactly", () => {
      expect(satisfies(["workflows:manage"], "Workflows:view")).toBe(false);
      expect(satisfies(["workflows:manage"], "WORKFLOWS:VIEW")).toBe(false);
    });
  });

  describe("when a custom role mixes manage and view grants", () => {
    /** @scenario "A mixed custom bag resolves each resource on its own grant" */
    it.concurrent("resolves each resource on its own grant, not the widest one", () => {
      const custom = ["workflows:manage", "datasets:view", "analytics:manage"];
      expect(satisfies(custom, "workflows:view")).toBe(true);
      expect(satisfies(custom, "datasets:view")).toBe(true);
      expect(satisfies(custom, "datasets:manage")).toBe(false);
      expect(satisfies(custom, "analytics:view")).toBe(true);
    });
  });
});

describe("the append-only registry", () => {
  it("derives runtime permission validation from it", () => {
    expect(authzPermissionSchema.options).toEqual(ALL_PERMISSIONS);
    expect(authzPermissionSchema.validate("traces:view")).toBe(true);
    expect(authzPermissionSchema.validate("traces:rotate")).toBe(false);
  });

  it("keeps braids:manage after every earlier index and moves none of them", () => {
    expect(ALL_PERMISSIONS.slice(0, INDICES_BEFORE_BRAIDS.length)).toEqual(INDICES_BEFORE_BRAIDS);
    expect(findPermissionIndex("braids:manage")).toBe(INDICES_BEFORE_BRAIDS.length);
  });

  /** @scenario "The braid permission is appended right after braids:manage and is never grantable" */
  it("appends spans:braided right after braids:manage, with only later appends behind it", () => {
    expect(findPermissionIndex(SPAN_BRAID_PERMISSION)).toBe(INDICES_BEFORE_BRAIDS.length + 1);
    expect(ALL_PERMISSIONS.slice(INDICES_BEFORE_BRAIDS.length + 2)).toEqual(["opsRead:view"]);
  });

  /** @scenario "The braid permission is appended right after braids:manage and is never grantable" */
  it("declares spans:braided at no scope, so no role, custom role or key may list it", () => {
    expect(isGrantablePermission(SPAN_BRAID_PERMISSION)).toBe(false);
    expect(grantablePermissionSchema.validate(SPAN_BRAID_PERMISSION)).toBe(false);
    expect(grantablePermissionSchema.validate("braids:manage")).toBe(true);
    expect(ALL_PERMISSIONS.filter((permission) => !isGrantablePermission(permission))).toEqual([
      SPAN_BRAID_PERMISSION,
    ]);
  });

  it("implies nothing to or from spans:braided", () => {
    expect(satisfies([SPAN_BRAID_PERMISSION], "traces:view")).toBe(false);
    expect(satisfies(["traces:view", "braids:manage"], SPAN_BRAID_PERMISSION)).toBe(false);
  });

  it("implies nothing from braids:manage beyond itself", () => {
    expect(satisfies(["braids:manage"], "braids:manage")).toBe(true);
    expect(satisfies(["braids:manage"], "traces:view")).toBe(false);
    expect(satisfies(["traces:share"], "braids:manage")).toBe(false);
  });
});
