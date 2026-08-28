/**
 * The gateway vertical's Enterprise tRPC surfaces, composed for the legacy web
 * application's router root.
 *
 * Three transports live here: routing policies (`routingPolicy`), personal
 * virtual keys (`personalVirtualKeys`) and webhook endpoints
 * (`webhookEndpoints`). Each router's behaviour — procedure names, input and
 * output shapes, refusals — belongs to its Enterprise feature package. What
 * this composition owns is the wiring: which policy wraps which declaration,
 * and which process capability answers each port.
 *
 * It sits in the Enterprise API composition rather than in `apps/api` for the
 * same reason its sibling does: a core package may not depend on an Enterprise
 * one. Everything the process must supply arrives through `create`, so this
 * package never imports an application.
 *
 * The remaining six gateway surfaces are core and mount from
 * `@langwatch/platform-api/app-trpc`.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  PersonalVirtualKeyTrpcApi,
  RoutingPolicyTrpcApi,
  type PersonalVirtualKeyTrpcContext,
  type PersonalVirtualKeyTrpcPorts,
  type RoutingPolicyTrpcContext,
} from "@langwatch/enterprise-governance-server";
import {
  WebhookEndpointTrpcApi,
  type WebhookEndpointTrpcContext,
  type WebhookEndpointTrpcPorts,
} from "@langwatch/enterprise-webhook-server";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Every context requirement the three surfaces place on the process. */
export type EnterpriseGatewayTrpcContext = PersonalVirtualKeyTrpcContext &
  RoutingPolicyTrpcContext &
  WebhookEndpointTrpcContext;

/** One already-composed process policy, applied after a feature's input parser. */
type EnterpriseTrpcPolicy = <TProcedure>(procedure: TProcedure) => TProcedure;

/** Explicit Enterprise gateway tRPC transports; mounting stays application-owned. */
export class EnterpriseGatewayTrpcComposition {
  static create<
    TContext extends EnterpriseGatewayTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TPersonalVirtualKeyPorts extends PersonalVirtualKeyTrpcPorts,
    TWebhookEndpointPorts extends WebhookEndpointTrpcPorts,
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
    ports: {
      personalVirtualKeys: TPersonalVirtualKeyPorts;
      webhookEndpoints: TWebhookEndpointPorts;
    };
  }) {
    const { root, protectedProcedure, policy, resolverAuthorizedPolicy, ports } = options;

    return {
      routingPolicy: RoutingPolicyTrpcApi.create(root, {
        protected: protectedProcedure,
        policy,
      }),
      personalVirtualKeys: PersonalVirtualKeyTrpcApi.create(
        root,
        { protected: protectedProcedure, policy, resolverAuthorizedPolicy },
        ports.personalVirtualKeys,
      ),
      webhookEndpoints: WebhookEndpointTrpcApi.create(
        root,
        { protected: protectedProcedure, policy },
        ports.webhookEndpoints,
      ),
    };
  }
}
