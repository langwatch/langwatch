/**
 * App-process transport mounts for the prompt vertical.
 *
 * Behaviour is package-owned (`@langwatch/prompt-server`); this supplies the
 * process's root, authenticated procedure, policy chain and the nurturing
 * side effect a new prompt triggers.
 */
import {
  PromptTagTrpcApi,
  PromptTrpcApi,
  type PromptTrpcContext,
  type PromptTrpcPorts,
} from "@langwatch/prompt-server";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { appTrpcPolicy, type AppTrpcPolicyMiddlewares } from "../../app-trpc/app-trpc.policy";

type PromptMount<
  TContext extends PromptTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
  ports: PromptTrpcPorts;
}>;

/** Mounts `prompts.*` on the app process's tRPC root. */
export function createPromptTrpcRouter<
  TContext extends PromptTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: PromptMount<TContext, TOptions, TRoot>) {
  return PromptTrpcApi.create(
    mount.root,
    {
      protected: mount.protectedProcedure,
      policy: appTrpcPolicy(mount.middlewares),
    },
    mount.ports,
  );
}

type PromptTagMount<
  TContext extends PromptTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
}>;

/** Mounts `promptTags.*` on the app process's tRPC root. */
export function createPromptTagTrpcRouter<
  TContext extends PromptTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: PromptTagMount<TContext, TOptions, TRoot>) {
  return PromptTagTrpcApi.create(mount.root, {
    protected: mount.protectedProcedure,
    policy: appTrpcPolicy(mount.middlewares),
  });
}
