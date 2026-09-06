/**
 * Two gates chain AFTER the declared policy: demo-project refusal first,
 * then `enforceLangyAccess`, so membership is proven before rollout is read.
 */
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  LangyEgressTrpcApi,
  LangyTrpcApi,
  type LangyEgressTrpcContext,
  type LangyEgressTrpcPorts,
  type LangyTrpcContext,
  type LangyTrpcPorts,
} from "@langwatch/langy-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/**
 * Middlewares, not declarations: neither gate names a permission
 * (`declaredCheckFrom` refuses that shape), so the process builds and hands
 * them over instead.
 */
export type LangyTrpcGates = Readonly<{
  /** Refuses the demo project outright, ahead of the rollout gate. */
  refuseDemoProject: unknown;
  /** The authoritative internal-only rollout decision, last in the chain. */
  enforceLangyAccess: unknown;
}>;

/** The `.use()` surface a built procedure exposes, named at the one seam that needs it. */
type ChainableProcedure = { use(middleware: unknown): ChainableProcedure };

/** The process chain plus the two Langy gates, in the order the host pinned. */
function langyPolicy(
  base: (permission: AuthzPermission) => <TProcedure>(procedure: TProcedure) => TProcedure,
  gates: LangyTrpcGates,
): (permission: AuthzPermission) => <TProcedure>(procedure: TProcedure) => TProcedure {
  return (permission: AuthzPermission) =>
    <TProcedure>(procedure: TProcedure): TProcedure =>
      (base(permission)(procedure) as unknown as ChainableProcedure)
        .use(gates.refuseDemoProject)
        .use(gates.enforceLangyAccess) as unknown as TProcedure;
}

/** Mounts `langy.*` — including its two subscriptions — on the process's root. */
export function createLangyTrpcRouter<
  TContext extends LangyTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot> &
    TrpcApiPorts<LangyTrpcPorts> &
    Readonly<{ gates: LangyTrpcGates }>,
) {
  const service = createTrpcApiService(mount);
  return LangyTrpcApi.create(
    mount.root,
    {
      protected: service.protected,
      policy: langyPolicy((permission) => service.policy(permission), mount.gates),
    },
    mount.ports,
  );
}

/** Mounts `langyEgress.*` beside it, on the same chain and the same application. */
export function createLangyEgressTrpcRouter<
  TContext extends LangyEgressTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot> &
    TrpcApiPorts<LangyEgressTrpcPorts> &
    Readonly<{ gates: LangyTrpcGates }>,
) {
  const service = createTrpcApiService(mount);
  return LangyEgressTrpcApi.create(
    mount.root,
    {
      protected: service.protected,
      policy: langyPolicy((permission) => service.policy(permission), mount.gates),
      validateOutput: service.validateOutput,
    },
    mount.ports,
  );
}
