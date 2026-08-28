/**
 * App-process transport mounts for the organization vertical's group and
 * join-request surfaces.
 *
 * Behaviour is package-owned (`@langwatch/organization-server`); this supplies
 * the process's root, authenticated procedure, policy chain, and the
 * application ports the organization package does not own — the Enterprise
 * plan gate behind groups, and the join-request service the process composes
 * over the identity ledger, the membership writer and the mailer.
 */
import {
  GroupTrpcApi,
  JoinRequestTrpcApi,
  type GroupTrpcContext,
  type GroupTrpcPorts,
  type JoinRequestTrpcContext,
  type JoinRequestTrpcPorts,
} from "@langwatch/organization-server";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { declaredPolicy, type AppTrpcPolicyMiddlewares } from "../../app-trpc/app-trpc.policy";

type GroupMount<
  TContext extends GroupTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
  ports: GroupTrpcPorts;
}>;

/** Mounts `group.*` on the app process's tRPC root. */
export function createGroupTrpcRouter<
  TContext extends GroupTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: GroupMount<TContext, TOptions, TRoot>) {
  return GroupTrpcApi.create(
    mount.root,
    {
      protected: mount.protectedProcedure,
      policy: declaredPolicy(mount.middlewares),
    },
    mount.ports,
  );
}

type JoinRequestMount<
  TContext extends JoinRequestTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
  ports: JoinRequestTrpcPorts;
}>;

/** Mounts `joinRequests.*` on the app process's tRPC root. */
export function createJoinRequestTrpcRouter<
  TContext extends JoinRequestTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: JoinRequestMount<TContext, TOptions, TRoot>) {
  return JoinRequestTrpcApi.create(
    mount.root,
    {
      protected: mount.protectedProcedure,
      policy: declaredPolicy(mount.middlewares),
    },
    mount.ports,
  );
}
