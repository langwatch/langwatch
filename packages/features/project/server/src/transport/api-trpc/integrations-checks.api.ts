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
import { createTrpcService, type TrpcPolicyDecorator } from "@langwatch/api/trpc";
import type { AuthzDeclaration, AuthzPermission } from "@langwatch/authz-contract";
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
   * audit policy for one access declaration. The chain applies it AFTER this
   * feature's input parser, which is the ordering the authorization check
   * depends on: a check installed before `.input()` reads no scope id.
   */
  policy(access: AuthzPermission | AuthzDeclaration): TrpcPolicyDecorator;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
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

    return (
      createTrpcService({
        root: trpc,
        procedures: { protected: procedure, policy },
        validateOutput: procedures.validateOutput,
      })
        /**
         * `project:update` rather than `project:view`: the answer drives the
         * setup checklist, and a reader who cannot change the project cannot act
         * on a single step it lists. The gate this surface has always carried.
         */
        .query("getCheckStatus", (p) =>
          p
            .withInput(getCheckStatusInputSchema)
            // The rollup's shape is the process's, not the project's: it is
            // generic in this surface, so there is no schema here to state it.
            .withoutOutput(
              "the process owns the checklist's shape, and this surface is generic in it",
            )
            .withPermission("project:update")
            .handle(({ ctx, input }) => ports.getCheckStatus(ctx, { projectId: input.projectId })),
        )
        .build()
    );
  }
}
