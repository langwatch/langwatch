/**
 * The setup instructions the empty states copy for a coding agent. The bodies are ~100 kB of
 * markdown, so they stay on the server and reach the browser only when a reader opens a setup menu.
 * Spec: specs/skills/empty-state-skill-setup.feature
 */
import { NotFoundError } from "@langwatch/handled-error";
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import { SetupSkillsService } from "../../services/setup-skills.service";

/**
 * The surface reads nothing off the request beyond the project the permission
 * is checked against, so the context is the empty object every mounted
 * procedure already satisfies.
 */
export type SetupSkillsTrpcContext = Readonly<object>;

type SetupSkillsTrpcProcedures<
  TContext extends SetupSkillsTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and audit policy for one
   * declared permission.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/** Installs the `setupSkills.*` tRPC surface on a process-owned root. */
export class SetupSkillsTrpcApi {
  static create<
    TContext extends SetupSkillsTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: SetupSkillsTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      getPrompt: policy("project:view")(
        procedure.input(z.object({ projectId: z.string(), skill: z.string() })),
      ).query(({ input }: { input: { projectId: string; skill: string } }) => {
        const skills = SetupSkillsService.create();
        if (!skills.isSetupSkillId(input.skill)) {
          throw new NotFoundError("not_found", "Setup guide", input.skill);
        }
        return { body: skills.body(input.skill) };
      }),
    });
  }
}
