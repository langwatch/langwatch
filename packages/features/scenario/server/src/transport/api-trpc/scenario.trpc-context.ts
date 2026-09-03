/**
 * The context, procedure surface and process ports every scenario tRPC
 * adapter shares.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import type { ScenarioApp } from "#app/scenario.app";

/**
 * The process supplies authentication; authorization arrives as `policy`.
 *
 * `app` is the slice of the process's application this feature reaches, not
 * the feature's application itself, because a tRPC root is shared by every
 * feature mounted on it and so carries all of them. It was a
 * `ScenarioApplication` bag of six services declared here, in the transport —
 * which is why nothing but a tRPC context could be handed the feature's
 * composition. {@link ScenarioApp} holds those six now.
 */
export type ScenarioTrpcContext = Readonly<{
  app: Readonly<{ scenarios: ScenarioApp }>;
  actor(): Readonly<{ id: string }>;
  /**
   * The request's own abort signal. tRPC v10 callers leave `opts.signal`
   * undefined, so the subscription reads this instead: without it a
   * disconnected client keeps the generator suspended, its emitter listener
   * attached, and its tab registered forever.
   */
  signal: AbortSignal | undefined;
}>;

export type ScenarioTrpcProcedures<
  TContext extends ScenarioTrpcContext,
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
 * The process capabilities this transport needs that are not scenario's own:
 * product analytics and the lifecycle nurturing that fire when someone writes
 * their first test cases. Fire-and-forget by design — none of them may fail a
 * create.
 */
export type ScenarioTrpcPorts = Readonly<{
  /** Records the product-analytics event for a newly created scenario. */
  trackScenarioCreated(input: Readonly<{ userId: string; projectId: string }>): void;
  /** Drives the "you have written N test cases" nurturing sequence. */
  fireScenarioCreatedNurturing(
    input: Readonly<{
      userId: string;
      scenarioCount: number;
      scenarioId: string;
      projectId: string;
    }>,
  ): void;
  /** Where a failure in either of the above goes instead of the caller. */
  captureException(error: Error | string): void;
}>;
