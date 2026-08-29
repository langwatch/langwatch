/**
 * The context, procedure surface and process ports every prompt tRPC adapter
 * shares.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import type { PromptApp } from "#app/prompt.app";

/**
 * The process supplies authentication; authorization arrives as `policy`.
 *
 * `app` is the slice of the process's application this feature reaches, not
 * the feature's application itself, because a tRPC root is shared by every
 * feature mounted on it and so carries all of them. A REST door, whose service
 * is built per family, would hold {@link PromptApp} directly. Both prompt
 * doors take this same slice, which is what stopped them describing the
 * composition twice.
 */
export type PromptTrpcContext = Readonly<{
  app: Readonly<{ prompts: PromptApp }>;
  actor(): Readonly<{ id: string }>;
  /**
   * Whether the caller holds a permission on a project OTHER than the one the
   * declared check already gated. Copy, push and sync each reach a second
   * project the input names, and the declared check covers only the first, so
   * the second is probed here and the handler owns the refusal.
   */
  can(permission: AuthzPermission, target: Readonly<{ projectId: string }>): Promise<boolean>;
}>;

export type PromptTrpcProcedures<
  TContext extends PromptTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/**
 * The process capabilities this transport needs that are not prompt's own.
 */
export type PromptTrpcPorts = Readonly<{
  /**
   * The lifecycle nurturing that fires when a project gains a prompt, whether
   * written, copied or duplicated. Fire-and-forget: it may not fail a create.
   */
  afterPromptCreated(input: Readonly<{ projectId: string; userId?: string | null }>): void;
}>;
