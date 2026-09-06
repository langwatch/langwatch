/**
 * Package-owned (`@langwatch/project-server`); adds the two readers it
 * doesn't own — recent activity (walks the audit trail) and the setup
 * rollup (fans out across the verticals holding the evidence).
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
 * Mounts `integrationsChecks.*`. `TCheckStatus` is inferred from the
 * process's own reader so the checklist keeps its real shape.
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
 * `create` resolves its permission tier at runtime (team vs org).
 * `traceSharingEnabled` adds `project:manage` AFTER `project:update`.
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
      validateOutput: service.validateOutput,
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
 * Middlewares, not descriptions: `declaredCheckFrom` refuses to build a
 * custom check from one, since the claim of what enforces the scope has to
 * be written where the enforcement runs.
 */
export type ProjectTrpcChecks = Readonly<{
  /** `project.create`'s own `kind: "custom"` declaration and its resolution. */
  create: unknown;
  /** The extra `project:manage` demand a trace-sharing flip carries. */
  traceSharing: unknown;
}>;

/** The process capabilities `project.*` reaches that the project does not own. */
export type ProjectTrpcMountPorts = Parameters<typeof ProjectTrpcApi.create>[2];
