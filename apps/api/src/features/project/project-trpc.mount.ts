/**
 * App-process transport mounts for the project vertical's two page surfaces.
 *
 * Behaviour is package-owned (`@langwatch/project-server`); these supply the
 * process's root, authenticated procedure, policy chain, and the two readers
 * the project does not own — recent activity, which walks the process's audit
 * trail and hydrates each entity it finds there, and the setup rollup, which
 * fans out across the nine verticals holding the evidence.
 */
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import {
  HomeTrpcApi,
  IntegrationsChecksTrpcApi,
  ProjectTrpcApi,
  type HomeTrpcContext,
  type HomeTrpcPorts,
  type IntegrationsChecksTrpcContext,
  type IntegrationsChecksTrpcPorts,
  type ProjectTrpcContext,
} from "@langwatch/project-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Mounts `home.*` on the app process's tRPC root. */
export function createHomeTrpcRouter<
  TContext extends HomeTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPorts<HomeTrpcPorts>) {
  return HomeTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}

/**
 * Mounts `integrationsChecks.*` on the app process's tRPC root.
 *
 * The port is forwarded untouched, and `TCheckStatus` is inferred from the
 * process's own reader, so the checklist reaches the client with the shape it
 * has always had rather than a narrowed copy of it.
 */
export function createIntegrationsChecksTrpcRouter<
  TContext extends IntegrationsChecksTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TCheckStatus,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot> &
    TrpcApiPorts<IntegrationsChecksTrpcPorts<TCheckStatus>>,
) {
  return IntegrationsChecksTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}

/**
 * Mounts `project.*` on the app process's tRPC root.
 *
 * Two of its eight procedures need a policy the shared kit cannot build from a
 * permission alone, so this mount builds them from the process's own declared
 * check rather than from `createTrpcApiService`'s `policy`:
 *
 *  - `create` names two tiers and acts on exactly one, decided by what was
 *    asked for. Creating INTO a team asks that team for `project:create`;
 *    creating a team alongside asks the organization for
 *    `organization:manage`. Neither fixed tier could express it, so the
 *    declaration is `kind: "custom"` and the runtime resolves the tier from
 *    the validated input.
 *  - `update` runs at `project:update`, except that flipping
 *    `traceSharingEnabled` also demands `project:manage` — it changes who
 *    OUTSIDE the project may read its traces. That second demand sits AFTER
 *    the declared check, exactly where the platform router chained it, so a
 *    caller is placed by RBAC first and refused by the sharing rule second.
 */
export function createProjectTrpcRouter<
  TContext extends ProjectTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot> &
    TrpcApiPorts<ProjectTrpcMountPorts> &
    Readonly<{ checks: ProjectTrpcChecks }>,
) {
  const service = createTrpcApiService(mount);

  return ProjectTrpcApi.create(
    mount.root,
    {
      protected: service.protected,
      policy: service.policy,
      createPolicy: service.custom(mount.checks.create),
      updatePolicy: <TProcedure>(procedure: TProcedure): TProcedure =>
        (service.policy("project:update")(procedure) as unknown as ChainableProcedure).use(
          mount.checks.traceSharing,
        ) as unknown as TProcedure,
    },
    mount.ports,
  );
}

/**
 * The `.use()` surface every tRPC procedure builder shares. Named at the one
 * seam that chains the trace-sharing demand onto a builder whose input
 * generics belong to the feature package, so the policy above needs no `any`.
 */
type ChainableProcedure = { use(middleware: unknown): ChainableProcedure };

/**
 * The two data-dependent gates the project surface needs, already built.
 *
 * Middlewares rather than descriptions, for the reason `declaredCheckFrom`
 * refuses to build a custom check from a description: each one CLAIMS what
 * enforces the scope, and a claim has to be written where the enforcement is.
 */
export type ProjectTrpcChecks = Readonly<{
  /** `project.create`'s own `kind: "custom"` declaration and its resolution. */
  create: unknown;
  /** The extra `project:manage` demand a trace-sharing flip carries. */
  traceSharing: unknown;
}>;

/** The process capabilities `project.*` reaches that the project does not own. */
export type ProjectTrpcMountPorts = Parameters<typeof ProjectTrpcApi.create>[2];
