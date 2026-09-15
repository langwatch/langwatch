/** Compose Enterprise gateway tRPC surfaces (routing policies, personal virtual keys).
 * Belongs here, not apps/api, because core packages cannot depend on Enterprise ones;
 * this composition wires process dependencies through create().
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  PersonalVirtualKeyTrpcApi,
  RoutingPolicyTrpcApi,
  type PersonalVirtualKeyTrpcContext,
  type RoutingPolicyTrpcContext,
} from "@langwatch/enterprise-governance-server";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Every context requirement the two surfaces place on the process. */
export type EnterpriseGatewayTrpcContext = PersonalVirtualKeyTrpcContext &
  RoutingPolicyTrpcContext;

/** One already-composed process policy, applied after a feature's input parser. */
type EnterpriseTrpcPolicy = <TProcedure>(procedure: TProcedure) => TProcedure;

/** Explicit Enterprise gateway tRPC transports; mounting stays application-owned. */
export class EnterpriseGatewayTrpcComposition {
  static create<
    TContext extends EnterpriseGatewayTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(options: {
    /** The process's one tRPC root; feature routers must not create a second. */
    root: TRPCRootObject<TContext, object, TOptions, TRoot>;
    /** The process's authenticated procedure. */
    protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
    /** The process's full policy chain for one declared permission. */
    policy(permission: AuthzPermission): EnterpriseTrpcPolicy;
    /**
     * The chain for a declaration whose scope the resolver decides from data it
     * loads, recording why and which permissions the resolver enforces.
     */
    resolverAuthorizedPolicy(declaration: {
      reason: string;
      permissions: readonly AuthzPermission[];
    }): EnterpriseTrpcPolicy;
    /**
     * Check each answer against the output schema its procedure declared. The
     * process decides; production leaves it off.
     */
    validateOutput: boolean;
  }) {
    const { root, protectedProcedure, policy, resolverAuthorizedPolicy, validateOutput } = options;

    return {
      routingPolicy: RoutingPolicyTrpcApi.create(root, {
        protected: protectedProcedure,
        policy,
        validateOutput,
      }),
      personalVirtualKeys: PersonalVirtualKeyTrpcApi.create(root, {
        protected: protectedProcedure,
        policy,
        resolverAuthorizedPolicy,
        validateOutput,
      }),
    };
  }
}
