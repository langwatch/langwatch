/**
 * How far a project has been set up, over the process's tRPC transport.
 *
 * One procedure: `getCheckStatus`. Its input is a project id, its gate is
 * `project:update`, and its answer is "which of the setup steps this project
 * has completed" — a fact about the project, which is why the project feature
 * owns it rather than a feature of its own. It is the sibling `home.api.ts`
 * names: recent activity there, setup progress here.
 *
 * The counts behind it are NOT the project's to read. They come from nine
 * other verticals — workflows, custom graphs, datasets, online evaluations,
 * triggers, team members, model providers, simulations and prompts — plus two
 * columns the project itself owns. Reading nine features' storage from this
 * package would be the boundary violation the layout exists to prevent, so the
 * whole rollup arrives through {@link IntegrationsChecksTrpcPorts} and the
 * process answers it with the reader it already composes. Generic over the
 * status, so the shape the client sees is the process's own and not a narrowed
 * copy of it.
 *
 * Transport only: the gate, the input parser, and delegation to that port.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

/**
 * Nothing, stated rather than left implicit.
 *
 * The procedure reads its project from validated input and its answer from the
 * port, so it places no requirement on the process's request context. A later
 * read that needs one is a change to this line, and to every mount that has to
 * satisfy it.
 */
export type IntegrationsChecksTrpcContext = object;

type IntegrationsChecksTrpcProcedures<
  TContext extends IntegrationsChecksTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission.
   *
   * Applied AFTER this feature's own input parser rather than composed ahead
   * of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/** The process capability this transport needs that is not the project's own. */
export type IntegrationsChecksTrpcPorts<TCheckStatus> = Readonly<{
  /**
   * Which setup steps this project has completed, as the onboarding surfaces
   * render them. The process's reader fans out across the verticals that hold
   * the evidence; a datastore it cannot reach counts as "not done" rather than
   * failing the whole answer.
   */
  getCheckStatus(
    ctx: IntegrationsChecksTrpcContext,
    input: Readonly<{ projectId: string }>,
  ): Promise<TCheckStatus>;
}>;

const getCheckStatusInputSchema = z.object({
  projectId: z.string(),
});

/** Installs the complete `integrationsChecks.*` tRPC surface on a process root. */
export class IntegrationsChecksTrpcApi {
  static create<
    TContext extends IntegrationsChecksTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TCheckStatus,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: IntegrationsChecksTrpcProcedures<TContext, TOptions, TRoot>,
    ports: IntegrationsChecksTrpcPorts<TCheckStatus>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      /**
       * `project:update` rather than `project:view`: the answer drives the
       * setup checklist, and a reader who cannot change the project cannot act
       * on a single step it lists. The gate this surface has always carried.
       */
      getCheckStatus: policy("project:update")(procedure.input(getCheckStatusInputSchema)).query(
        ({ ctx, input }) => ports.getCheckStatus(ctx, { projectId: input.projectId }),
      ),
    });
  }
}
