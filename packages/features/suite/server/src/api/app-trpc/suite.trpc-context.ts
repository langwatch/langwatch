/**
 * The context and procedure surface every suite tRPC adapter shares.
 *
 * The suite surface reads across four capabilities: suites themselves,
 * scenario folders (a folder IS a suite of kind "folder", so `suites.getAll`
 * and `suites.getById` answer for both), the project's owning organization,
 * and the simulation run summaries the suite list renders.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { ScenarioService, SimulationService } from "@langwatch/scenario-contract";
import type { SuiteService } from "@langwatch/suite-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";

export type SuiteApplication = Readonly<{
  suites: SuiteService;
  scenarios: ScenarioService;
  projects: ProjectService;
  simulations: SimulationService;
}>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type SuiteTrpcContext = Readonly<{ app: SuiteApplication }>;

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
