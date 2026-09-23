import type {
  AuthzDecision,
  AuthzScopeRef,
  CollectedBinding,
  CollectedGrants,
  ResourceGrant,
} from "./authz.ts";
/**
 * Pure deterministic resolver over CollectedGrants; walk order here, other
 * rules in siblings (ADR-092 §2). Legacy quirks tagged for staged removal.
 */
import { scopeChain, type ScopeChainLink } from "./scope.ts";
import {
  findBindingsStep,
  type DecideContext,
  findDemoProjectStep,
  denyStep,
  findOrganizationMembershipGateStep,
  findOrganizationRoleFloorStep,
  findResourceGrantStep,
} from "./walk.ts";

/**
 * The one resolver, as a service class (app-layer idiom). Stateless and
 * pure by construction: every method is a function of its arguments alone,
 * so one instance serves any number of callers.
 */
export class AuthzEngine {
  decide({
    grants,
    permission,
    scope,
    demoProjectId,
    resourceGrants,
  }: {
    grants: CollectedGrants;
    permission: string;
    scope: AuthzScopeRef;
    /** Pass process.env.DEMO_PROJECT_ID; parameterised for purity. */
    demoProjectId?: string | null;
    /** ADR-092 §8 — grants at the resource tier, collected for `scope`'s
     *  resource links (collectResourceGrants). Ignored for non-resource
     *  scopes. */
    resourceGrants?: readonly ResourceGrant[];
  }): AuthzDecision {
    const chain = scopeChain(scope);
    const context: DecideContext = {
      grants,
      permission,
      scope,
      demoProjectId,
      resourceGrants,
      chain,
      chainBindings: grants.bindings.filter((binding) =>
        chain.some(
          (link) => link.scopeType === binding.scopeType && link.scopeId === binding.scopeId,
        ),
      ),
      base: {
        permission,
        scope,
        principal: grants.principal,
        audience: "member",
      },
    };

    // The order IS the contract — each step answers or defers to the next.
    return (
      findDemoProjectStep(context) ??
      findOrganizationMembershipGateStep(context) ??
      findOrganizationRoleFloorStep(context) ??
      findBindingsStep(context) ??
      findResourceGrantStep(context) ??
      denyStep(context)
    );
  }

  /**
   * ADR-092 §9 — the API-key owner ceiling as engine algebra:
   * effective(key) = grants(key) ∩ grants(owner). Service keys (no owner)
   * have no ceiling.
   */
  decideWithCeiling({
    keyGrants,
    ownerGrants,
    permission,
    scope,
    demoProjectId,
    resourceGrants,
  }: {
    keyGrants: CollectedGrants;
    ownerGrants: CollectedGrants | null;
    permission: string;
    scope: AuthzScopeRef;
    demoProjectId?: string | null;
    resourceGrants?: readonly ResourceGrant[];
  }): AuthzDecision {
    const keyDecision = this.decide({
      grants: keyGrants,
      permission,
      scope,
      demoProjectId,
      resourceGrants,
    });
    if (!keyDecision.allowed || !ownerGrants) return keyDecision;

    const ownerDecision = this.decide({
      grants: ownerGrants,
      permission,
      scope,
      demoProjectId,
      resourceGrants,
    });
    if (ownerDecision.allowed) return keyDecision;

    return {
      ...keyDecision,
      allowed: false,
      via: undefined,
      matchedBinding: undefined,
      denialReason: "owner-ceiling",
    };
  }

  private explainBindingLine({
    binding,
    chain,
    decision,
  }: {
    binding: CollectedBinding;
    chain: readonly ScopeChainLink[];
    decision: AuthzDecision;
  }): string {
    const who = binding.viaGroupId ? ` (via group ${binding.viaGroupId})` : "";
    const label = `${binding.roleKey} @ ${binding.scopeType.toLowerCase()} ${binding.scopeId}${who}`;
    const onChain = chain.some(
      (link) => link.scopeType === binding.scopeType && link.scopeId === binding.scopeId,
    );
    if (!onChain) return `  - ${label} — filtered out: not on this scope chain`;
    const matched =
      decision.matchedBinding === binding
        ? "GRANTS the permission"
        : `does not grant ${decision.permission}`;
    return `  - ${label} — ${matched}`;
  }

  explain({ decision, grants }: { decision: AuthzDecision; grants: CollectedGrants }): string[] {
    const lines: string[] = [];
    const scopeLabel = `${decision.scope.type} ${decision.scope.id}`;
    lines.push(`${decision.allowed ? "GRANTED" : "DENIED"} ${decision.permission} @ ${scopeLabel}`);

    if (decision.via === "demo-project") {
      lines.push("granted: demo project (read-only demo-viewer set)");
      return lines;
    }
    if (decision.via === "org-role-floor") {
      lines.push("granted: every organization member holds this permission");
      return lines;
    }
    if (decision.via === "resource-grant") {
      lines.push(
        "granted: a resource-tier grant on this resource (or a shareable ancestor) covers it",
      );
      return lines;
    }

    const chain = scopeChain(decision.scope);
    lines.push(`collected ${grants.bindings.length} binding(s):`);
    for (const binding of grants.bindings) {
      lines.push(this.explainBindingLine({ binding, chain, decision }));
    }
    if (!decision.allowed) {
      lines.push(`denial reason: ${decision.denialReason ?? "unknown"}`);
    }
    return lines;
  }
}
