/**
 * App-process transport mounts for the Langy vertical: the conversation panel
 * and, beside it, the per-project egress allow-list that bounds what the agent
 * behind it may reach.
 *
 * Behaviour is package-owned (`@langwatch/langy-server`); these supply the
 * process's tRPC root, its authenticated procedure, its policy chain, the two
 * capabilities the feature does not own (the message and warm budgets, the
 * product-analytics sink, the UI-action channel, the audit trail) and — the
 * part that is not ordinary — the two Langy-specific gates the process chains
 * on top of every procedure's declared check.
 *
 * ## Why the two gates arrive already built
 *
 * They resolve nothing a permission name can express, and they run in this
 * order for a reason the platform host wrote down and this mount keeps:
 *
 *  - the DEMO refusal first, because `project:view` is granted to every
 *    authenticated user on the demo project, so a permission check alone would
 *    expose whatever Langy chat somebody left there;
 *  - `enforceLangyAccess` last, so membership is always proven by RBAC before
 *    the rollout flag is read — the gate must not double as a probe for whether
 *    Langy exists for the account.
 *
 * Both are appended AFTER `service.policy(permission)` rather than composed
 * ahead of it, which is the same rule the feature's own docblock states: tRPC
 * runs middlewares in the order they were added, and both gates read the
 * validated input's `projectId`.
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
 * The two process gates every customer-facing Langy procedure carries, as
 * middlewares rather than as descriptions.
 *
 * A description would have to name a permission, and neither of these is one:
 * the first compares the input's project against the deployment's demo project,
 * and the second evaluates a rollout rule against the caller and the project's
 * organization. `declaredCheckFrom` refuses exactly that shape, which is why
 * the process builds them and hands them over.
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
    },
    mount.ports,
  );
}
