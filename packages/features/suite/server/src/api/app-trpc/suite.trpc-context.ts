/**
 * The context and procedure surface every suite tRPC adapter shares.
 *
 * The suite surface reads across four capabilities — suites themselves,
 * scenario folders (a folder IS a suite of kind "folder", so `suites.getAll`
 * and `suites.getById` answer for both), the project's owning organization,
 * and the simulation run summaries the suite list renders — and reaches all
 * four through {@link SuiteApp}, which is what the four-key `SuiteApplication`
 * bag this context used to declare has become.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import type { SuiteApp } from "#app/suite.app";

/**
 * The process supplies authentication; authorization arrives as `policy`.
 *
 * `app` is the slice of the process's application this feature reaches, not
 * the feature's application itself, because a tRPC root is shared by every
 * feature mounted on it and so carries all of them. The REST family, built per
 * family, holds {@link SuiteApp} directly. Both reach the same object; only the
 * path to it differs.
 */
export type SuiteTrpcContext = Readonly<{ app: Readonly<{ suites: SuiteApp }> }>;

export type SuiteTrpcProcedures<
  TContext extends SuiteTrpcContext,
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
